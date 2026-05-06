import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, requireTeamRole, isNextResponse } from "@/lib/rbac";
import {
  badRequest,
  conflict,
  created,
  forbidden,
  handleError,
  notFound,
  unauthorized,
} from "@/lib/api-response";
import {
  CadenceKind,
  Prisma,
  ShiftSource,
  ShiftStatus,
  SystemRole,
  TeamRole,
} from "@/app/generated/prisma/client";
import { computeConfirmationDueAt, localDayKeysForWindow } from "@/lib/rotation/engine";
import { scheduleAllRemindersForBatchSafe } from "@/lib/queue/scheduler";
import { notifyAssigneesScheduleUpdated } from "@/lib/notifications/notify-assignees";
import { writeAuditLog } from "@/lib/audit";
import {
  combineScheduleDateTime,
  normalizeScheduleIdentity,
  parseScheduleCsv,
  ScheduleCsvMetadata,
} from "@/lib/schedule/csv-import";
import {
  filterTeamMembersByPolicySelection,
  getPolicyParticipantUserIds,
  setPolicyParticipantUserIds,
} from "@/lib/rotation/policy-participants";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { getPolicyTelegramOptions, updatePolicyTelegramOptions } from "@/lib/rotation/policy-telegram-options";
import { SCHEDULE_BACKUP_SCHEMA, type ScheduleBackupTeamMember } from "@/lib/schedule/backup";

const MAX_CSV_BYTES = 2 * 1024 * 1024;
const MAX_ERRORS = 100;

type TeamUserLite = {
  id: string;
  email: string;
  fullName: string;
};

type ShiftDraft = {
  line: number;
  assigneeId: string;
  backupId: string | null;
  startsAt: Date;
  endsAt: Date;
  notes: string | null;
};

type ShiftWindow = {
  startsAt: Date;
  endsAt: Date;
};

type ConflictError = {
  line: number;
  message: string;
};

type RestoreMetadata = {
  teamName: string;
  teamDescription: string | null;
  policyName: string;
  cadence: CadenceKind;
  cronExpression: string | null;
  shiftDurationHours: number;
  handoverOffsetMinutes: number;
  confirmationDueHours: number;
  reminderLeadHours: number[];
  maxGenerateWeeks: number;
  timezone: string;
  timeSlots: unknown[];
  checklistRequired: boolean;
  templateTasks: string[];
  telegramRequirePhotoOnConfirm: boolean;
  telegramEndShiftReminderEnabled: boolean;
  telegramRequirePhotoOnCheckout: boolean;
  teamMembers: ScheduleBackupTeamMember[];
  participantUserEmails: string[];
};

type PolicyWithTeamMembers = Awaited<ReturnType<typeof prisma.rotationPolicy.findUnique>> & {
  team: {
    id: string;
    members: Array<{
      user: {
        id: string;
        email: string;
        fullName: string;
      };
    }>;
  };
};

function overlaps(a: ShiftWindow, b: ShiftWindow): boolean {
  return a.startsAt < b.endsAt && a.endsAt > b.startsAt;
}

function hasSharedLocalDay(a: ShiftWindow, b: ShiftWindow, timezone: string): boolean {
  const aDays = new Set(localDayKeysForWindow(a.startsAt, a.endsAt, timezone));
  return localDayKeysForWindow(b.startsAt, b.endsAt, timezone).some((day) => aDays.has(day));
}

function firstSharedLocalDay(a: ShiftWindow, b: ShiftWindow, timezone: string): string | null {
  const aDays = new Set(localDayKeysForWindow(a.startsAt, a.endsAt, timezone));
  for (const day of localDayKeysForWindow(b.startsAt, b.endsAt, timezone)) {
    if (aDays.has(day)) return day;
  }
  return null;
}

function pushError(errors: ConflictError[], line: number, message: string): void {
  if (errors.length < MAX_ERRORS) {
    errors.push({ line, message });
  }
}

function formatDateTimeInTimezone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatRangeInTimezone(startsAt: Date, endsAt: Date, timezone: string): string {
  return `${formatDateTimeInTimezone(startsAt, timezone)} - ${formatDateTimeInTimezone(endsAt, timezone)}`;
}

function buildTeamUserIndex(teamUsers: TeamUserLite[]) {
  const byEmail = new Map<string, TeamUserLite>();
  const byName = new Map<string, TeamUserLite[]>();

  for (const user of teamUsers) {
    byEmail.set(user.email.trim().toLowerCase(), user);
    const normalizedName = normalizeScheduleIdentity(user.fullName);
    if (!normalizedName) continue;

    const list = byName.get(normalizedName) ?? [];
    list.push(user);
    byName.set(normalizedName, list);
  }

  return { byEmail, byName };
}

function resolveUserFromCsv(
  identifier: string,
  line: number,
  fieldLabel: string,
  index: ReturnType<typeof buildTeamUserIndex>,
  errors: ConflictError[]
): TeamUserLite | null {
  const trimmed = identifier.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  const looksLikeEmail = lower.includes("@");
  if (looksLikeEmail) {
    const user = index.byEmail.get(lower);
    if (!user) {
      pushError(errors, line, `${fieldLabel} "${identifier}" khÃ´ng thuá»™c team cá»§a policy`);
      return null;
    }
    return user;
  }

  const candidates = index.byName.get(normalizeScheduleIdentity(trimmed)) ?? [];
  if (candidates.length === 0) {
    pushError(errors, line, `${fieldLabel} "${identifier}" khÃ´ng thuá»™c team cá»§a policy`);
    return null;
  }
  if (candidates.length > 1) {
    pushError(
      errors,
      line,
      `${fieldLabel} "${identifier}" bá»‹ trÃ¹ng tÃªn. Vui lÃ²ng dÃ¹ng email Ä‘á»ƒ import.`
    );
    return null;
  }
  return candidates[0];
}

function parseTemplateTasks(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return fallback;
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseJsonArray(value: string | undefined): unknown[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function defaultFullNameFromEmail(email: string): string {
  const localPart = email.split("@")[0]?.trim() ?? "";
  if (!localPart) return email;

  const tokens = localPart
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

  if (tokens.length === 0) return email;
  return tokens
    .map((token) => token.slice(0, 1).toUpperCase() + token.slice(1))
    .join(" ");
}

function parseRestoreMetadata(metadata: ScheduleCsvMetadata): {
  data: RestoreMetadata | null;
  errors: ConflictError[];
} {
  const errors: ConflictError[] = [];
  const schema = metadata.schema?.trim();
  if (schema !== SCHEDULE_BACKUP_SCHEMA) {
    pushError(errors, 1, `schema backup khÃ´ng há»£p lá»‡. Cáº§n: ${SCHEDULE_BACKUP_SCHEMA}`);
    return { data: null, errors };
  }

  const teamName = (metadata.teamName ?? "").trim();
  const policyName = (metadata.policyName ?? "").trim();
  const cadenceRaw = (metadata.cadence ?? "").trim().toUpperCase();

  if (!teamName) pushError(errors, 1, "Thiáº¿u metadata teamName");
  if (!policyName) pushError(errors, 1, "Thiáº¿u metadata policyName");

  const cadenceValues = Object.values(CadenceKind);
  if (!cadenceValues.includes(cadenceRaw as CadenceKind)) {
    pushError(errors, 1, `cadence khÃ´ng há»£p lá»‡: ${cadenceRaw || "(trá»‘ng)"}`);
  }

  const cronExpressionRaw = (metadata.cronExpression ?? "").trim();
  const cadence = cadenceRaw as CadenceKind;
  const cronExpression = cadence === CadenceKind.CUSTOM_CRON
    ? cronExpressionRaw || null
    : null;
  if (cadence === CadenceKind.CUSTOM_CRON && !cronExpression) {
    pushError(errors, 1, "cadence CUSTOM_CRON nhÆ°ng thiáº¿u cronExpression");
  }

  const teamMembersRaw = parseJsonArray(metadata.teamMembers);
  if (!teamMembersRaw || teamMembersRaw.length === 0) {
    pushError(errors, 1, "Thiáº¿u metadata teamMembers");
  }

  const teamMembers: ScheduleBackupTeamMember[] = (teamMembersRaw ?? [])
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const record = item as { email?: unknown; fullName?: unknown; role?: unknown; order?: unknown };
      if (typeof record.email !== "string" || !record.email.trim()) return null;
      const role = record.role === "MANAGER" ? "MANAGER" : "MEMBER";
      const order = Number.isFinite(Number(record.order)) ? Number(record.order) : index;
      const fullName = typeof record.fullName === "string" ? record.fullName.trim() : "";
      return {
        email: record.email.trim().toLowerCase(),
        ...(fullName ? { fullName } : {}),
        role,
        order,
      } as ScheduleBackupTeamMember;
    })
    .filter((item): item is ScheduleBackupTeamMember => Boolean(item));

  if (teamMembers.length === 0) {
    pushError(errors, 1, "Metadata teamMembers khÃ´ng cÃ³ email há»£p lá»‡");
  }

  const participantEmailsRaw = parseJsonArray(metadata.participantUserEmails);
  const participantUserEmails = (participantEmailsRaw ?? [])
    .filter((item): item is string => typeof item === "string")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  const reminderLeadHoursRaw = parseJsonArray(metadata.reminderLeadHours);
  const reminderLeadHours = (reminderLeadHoursRaw ?? [])
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0);

  const timeSlotsRaw = parseJsonArray(metadata.timeSlots);
  const timeSlots = timeSlotsRaw ?? [];

  const templateTasksRaw = parseJsonArray(metadata.templateTasks);
  const templateTasks = (templateTasksRaw ?? [])
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);

  if (errors.length > 0) {
    return { data: null, errors };
  }

  const normalizedParticipants = participantUserEmails.length > 0
    ? participantUserEmails
    : teamMembers.map((member) => member.email);

  return {
    data: {
      teamName,
      teamDescription: (metadata.teamDescription ?? "").trim() || null,
      policyName,
      cadence,
      cronExpression,
      shiftDurationHours: Math.max(1, Math.min(168, parseNumber(metadata.shiftDurationHours, 8))),
      handoverOffsetMinutes: Math.max(0, parseNumber(metadata.handoverOffsetMinutes, 0)),
      confirmationDueHours: Math.max(1, parseNumber(metadata.confirmationDueHours, 24)),
      reminderLeadHours: reminderLeadHours.length > 0 ? reminderLeadHours : [48, 24, 2],
      maxGenerateWeeks: Math.max(1, Math.min(52, parseNumber(metadata.maxGenerateWeeks, 4))),
      timezone: (metadata.timezone ?? "Asia/Ho_Chi_Minh").trim() || "Asia/Ho_Chi_Minh",
      timeSlots,
      checklistRequired: parseBoolean(metadata.checklistRequired, false),
      templateTasks,
      telegramRequirePhotoOnConfirm: parseBoolean(metadata.telegramRequirePhotoOnConfirm, false),
      telegramEndShiftReminderEnabled: parseBoolean(metadata.telegramEndShiftReminderEnabled, false),
      telegramRequirePhotoOnCheckout: parseBoolean(metadata.telegramRequirePhotoOnCheckout, false),
      teamMembers,
      participantUserEmails: [...new Set(normalizedParticipants)],
    },
    errors,
  };
}

function buildDefaultBackupMap(orderedUserIds: string[]): Map<string, string | null> {
  const result = new Map<string, string | null>();
  if (orderedUserIds.length <= 1) {
    for (const userId of orderedUserIds) result.set(userId, null);
    return result;
  }

  for (let index = 0; index < orderedUserIds.length; index += 1) {
    const assigneeId = orderedUserIds[index];
    const backupId = orderedUserIds[(index + 1) % orderedUserIds.length] ?? null;
    result.set(assigneeId, backupId === assigneeId ? null : backupId);
  }
  return result;
}

async function createPolicyFromBackupMetadata(input: {
  actorId: string;
  metadata: RestoreMetadata;
  request: NextRequest;
}): Promise<
  | { policy: PolicyWithTeamMembers; createdTeamId: string | null; createdPolicyId: string | null }
  | { response: Response }
> {
  const { actorId, metadata, request } = input;

  const normalizedTeamMembers = [...metadata.teamMembers]
    .map((member, index) => {
      const email = member.email.trim().toLowerCase();
      if (!email) return null;
      const fullName = member.fullName?.trim() || defaultFullNameFromEmail(email);
      const role = member.role === "MANAGER" ? TeamRole.MANAGER : TeamRole.MEMBER;
      const order = Number.isFinite(member.order) ? Math.max(0, Math.floor(member.order)) : index;
      return { email, fullName, role, order };
    })
    .filter(
      (
        member
      ): member is { email: string; fullName: string; role: TeamRole; order: number } =>
        Boolean(member)
    )
    .sort((a, b) => a.order - b.order || a.email.localeCompare(b.email));

  const dedupedTeamMembers: Array<{ email: string; fullName: string; role: TeamRole; order: number }> = [];
  const seenMemberEmails = new Set<string>();
  for (const member of normalizedTeamMembers) {
    if (seenMemberEmails.has(member.email)) continue;
    dedupedTeamMembers.push({ ...member, order: dedupedTeamMembers.length });
    seenMemberEmails.add(member.email);
  }

  if (dedupedTeamMembers.length === 0) {
    return {
      response: badRequest("KhÃ´ng cÃ³ team member há»£p lá»‡ trong backup", [
        { line: 1, message: "Metadata teamMembers rá»—ng" },
      ]),
    };
  }

  if (!dedupedTeamMembers.some((member) => member.role === TeamRole.MANAGER)) {
    dedupedTeamMembers[0].role = TeamRole.MANAGER;
  }

  const participantEmails = [...new Set(metadata.participantUserEmails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
  const emailSet = new Set(dedupedTeamMembers.map((member) => member.email));
  for (const email of participantEmails) emailSet.add(email);
  const uniqueEmails = [...emailSet];
  const emailFilters = uniqueEmails.map((email) => ({
    email: { equals: email, mode: "insensitive" as const },
  }));

  const existingUsers = await prisma.user.findMany({
    where: { OR: emailFilters },
    select: { id: true, email: true, isActive: true },
  });
  const existingUserByEmail = new Map(existingUsers.map((user) => [user.email.trim().toLowerCase(), user]));
  const missingEmails = uniqueEmails.filter((email) => !existingUserByEmail.has(email));
  const inactiveEmails = existingUsers
    .filter((user) => !user.isActive)
    .map((user) => user.email.trim().toLowerCase());
  if (missingEmails.length > 0 || inactiveEmails.length > 0) {
    const details = [
      ...missingEmails.map((email) => ({ line: 1, message: `User không tồn tại: ${email}` })),
      ...inactiveEmails.map((email) => ({ line: 1, message: `User đang inactive: ${email}` })),
    ];
    return {
      response: badRequest(
        "Không thể restore vì có user không tồn tại hoặc đang inactive",
        details
      ),
    };
  }
  const userByEmail = new Map(
    existingUsers
      .filter((user) => user.isActive)
      .map((user) => [user.email.trim().toLowerCase(), user])
  );

  const teamMembers = dedupedTeamMembers
    .map((member) => {
      const user = userByEmail.get(member.email);
      if (!user) return null;
      return {
        userId: user.id,
        role: member.role,
        order: member.order,
      };
    })
    .filter((member): member is { userId: string; role: TeamRole; order: number } => Boolean(member));

  if (teamMembers.length === 0) {
    return {
      response: badRequest("KhÃ´ng cÃ³ team member há»£p lá»‡ trong backup", [
        { line: 1, message: "Metadata teamMembers rá»—ng" },
      ]),
    };
  }

  if (!teamMembers.some((member) => member.role === TeamRole.MANAGER)) {
    teamMembers[0].role = TeamRole.MANAGER;
  }

  const memberByUserId = new Map(teamMembers.map((member) => [member.userId, member]));
  let nextOrder = teamMembers.length;
  const participantUserIds: string[] = [];
  const seenParticipantIds = new Set<string>();
  for (const email of participantEmails) {
    const user = userByEmail.get(email);
    if (!user) continue;
    if (!memberByUserId.has(user.id)) {
      const addedMember = { userId: user.id, role: TeamRole.MEMBER, order: nextOrder };
      nextOrder += 1;
      teamMembers.push(addedMember);
      memberByUserId.set(user.id, addedMember);
    }
    if (!seenParticipantIds.has(user.id)) {
      seenParticipantIds.add(user.id);
      participantUserIds.push(user.id);
    }
  }

  const selectedParticipantIds = participantUserIds.length > 0
    ? participantUserIds
    : teamMembers.map((member) => member.userId);

  const restoredPair = await prisma.$transaction(async (tx) => {
    let team = await tx.team.findUnique({
      where: { name: metadata.teamName },
    });
    let createdTeamId: string | null = null;
    if (!team) {
      team = await tx.team.create({
        data: {
          name: metadata.teamName,
          description: metadata.teamDescription,
        },
      });
      createdTeamId = team.id;
    }

    const existingMembers = await tx.teamMember.findMany({
      where: { teamId: team.id },
      select: { userId: true },
    });
    const existingMemberIds = new Set(existingMembers.map((member) => member.userId));
    const membersToCreate = teamMembers.filter((member) => !existingMemberIds.has(member.userId));
    if (membersToCreate.length > 0) {
      await tx.teamMember.createMany({
        data: membersToCreate.map((member) => ({
          teamId: team.id,
          userId: member.userId,
          role: member.role,
          order: member.order,
        })),
        skipDuplicates: true,
      });
    }

    const existingPolicy = await tx.rotationPolicy.findFirst({
      where: {
        teamId: team.id,
        name: metadata.policyName,
      },
      orderBy: { createdAt: "asc" },
    });

    const policyData = {
      teamId: team.id,
      name: metadata.policyName,
      cadence: metadata.cadence,
      cronExpression: metadata.cronExpression,
      shiftDurationHours: metadata.shiftDurationHours,
      handoverOffsetMinutes: metadata.handoverOffsetMinutes,
      confirmationDueHours: metadata.confirmationDueHours,
      reminderLeadHours: metadata.reminderLeadHours,
      maxGenerateWeeks: metadata.maxGenerateWeeks,
      timeSlots: metadata.timeSlots as Prisma.InputJsonValue,
      timezone: metadata.timezone,
      isActive: true,
    } satisfies Prisma.RotationPolicyUncheckedCreateInput;

    let policy = existingPolicy;
    let createdPolicyId: string | null = null;
    if (!policy) {
      policy = await tx.rotationPolicy.create({
        data: policyData,
      });
      createdPolicyId = policy.id;
    } else {
      policy = await tx.rotationPolicy.update({
        where: { id: policy.id },
        data: {
          cadence: policyData.cadence,
          cronExpression: policyData.cronExpression,
          shiftDurationHours: policyData.shiftDurationHours,
          handoverOffsetMinutes: policyData.handoverOffsetMinutes,
          confirmationDueHours: policyData.confirmationDueHours,
          reminderLeadHours: policyData.reminderLeadHours,
          maxGenerateWeeks: policyData.maxGenerateWeeks,
          timeSlots: policyData.timeSlots,
          timezone: policyData.timezone,
          isActive: true,
        },
      });
    }

    return {
      team,
      policy,
      createdTeamId,
      createdPolicyId,
    };
  });

  await setPolicyParticipantUserIds(restoredPair.policy.id, selectedParticipantIds);
  await updatePolicyTelegramOptions(restoredPair.policy.id, {
    requirePhotoOnConfirm: metadata.telegramRequirePhotoOnConfirm,
    endShiftReminderEnabled: metadata.telegramEndShiftReminderEnabled,
    requirePhotoOnCheckout: metadata.telegramRequirePhotoOnCheckout,
  });

  try {
    await prisma.$executeRaw`
      UPDATE rotation_policies
      SET checklist_required = ${metadata.checklistRequired}::boolean,
          template_tasks     = ${JSON.stringify(metadata.templateTasks)}::jsonb
      WHERE id = ${restoredPair.policy.id}::uuid
    `;
  } catch {
    // Migration columns may not exist in some environments.
  }

  const auditPayloads: Promise<unknown>[] = [];
  if (restoredPair.createdTeamId) {
    auditPayloads.push(
      writeAuditLog({
        actorId,
        entityType: "Team",
        entityId: restoredPair.team.id,
        action: "RESTORE_CREATE",
        newValue: {
          name: restoredPair.team.name,
          description: restoredPair.team.description,
          memberCount: teamMembers.length,
        },
        ipAddress: request.headers.get("x-forwarded-for") ?? undefined,
      })
    );
  }
  auditPayloads.push(
    writeAuditLog({
      actorId,
      entityType: "RotationPolicy",
      entityId: restoredPair.policy.id,
      action: restoredPair.createdPolicyId ? "RESTORE_CREATE" : "RESTORE_UPDATE",
      newValue: {
        teamId: restoredPair.team.id,
        name: restoredPair.policy.name,
        cadence: restoredPair.policy.cadence,
        createdTeamId: restoredPair.createdTeamId,
      },
      ipAddress: request.headers.get("x-forwarded-for") ?? undefined,
    })
  );
  await Promise.all(auditPayloads);

  const policy = await prisma.rotationPolicy.findUnique({
    where: { id: restoredPair.policy.id },
    include: {
      team: {
        include: {
          members: {
            include: {
              user: {
                select: { id: true, email: true, fullName: true },
              },
            },
            orderBy: { order: "asc" },
          },
        },
      },
    },
  }) as PolicyWithTeamMembers | null;

  if (!policy) {
    return {
      response: notFound("KhÃ´ng Ä‘á»c Ä‘Æ°á»£c policy sau khi restore"),
    };
  }

  return {
    policy,
    createdTeamId: restoredPair.createdTeamId,
    createdPolicyId: restoredPair.createdPolicyId,
  };
}

function buildPolicyUserLabelById(users: TeamUserLite[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const user of users) {
    map.set(user.id, user.email || user.fullName || user.id);
  }
  return map;
}

export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, RATE_LIMITS.WRITE);
  if (limited) return limited;

  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const form = await req.formData();
    const policyIdRaw = form.get("policyId");
    const csvFileRaw = form.get("file");

    const policyId = typeof policyIdRaw === "string" ? policyIdRaw.trim() : "";
    if (!(csvFileRaw instanceof File)) {
      return badRequest("Vui lÃ²ng chá»n file CSV Ä‘á»ƒ import");
    }
    if (csvFileRaw.size <= 0) {
      return badRequest("File CSV rá»—ng");
    }
    if (csvFileRaw.size > MAX_CSV_BYTES) {
      return badRequest("File CSV vÆ°á»£t quÃ¡ 2MB");
    }

    const csvText = await csvFileRaw.text();
    const parsed = parseScheduleCsv(csvText);
    if (parsed.errors.length > 0) {
      return badRequest(
        "CSV khÃ´ng há»£p lá»‡",
        parsed.errors.slice(0, MAX_ERRORS).map((error) => ({
          line: error.line,
          field: error.field,
          message: error.message,
        }))
      );
    }

    let policy: PolicyWithTeamMembers | null = null;
    let createdTeamId: string | null = null;
    let createdPolicyId: string | null = null;
    let restoredFromBackup = false;

    if (policyId) {
      const found = await prisma.rotationPolicy.findUnique({
        where: { id: policyId },
        include: {
          team: {
            include: {
              members: {
                include: {
                  user: { select: { id: true, email: true, fullName: true } },
                },
                orderBy: { order: "asc" },
              },
            },
          },
        },
      }) as PolicyWithTeamMembers | null;

      if (!found) return notFound("Policy khÃ´ng tá»“n táº¡i");
      if (!found.isActive) {
        return conflict("Policy Ä‘ang inactive. HÃ£y kÃ­ch hoáº¡t policy trÆ°á»›c khi import.", "POLICY_INACTIVE");
      }

      const roleCheck = await requireTeamRole(found.teamId, TeamRole.MANAGER);
      if (isNextResponse(roleCheck)) return roleCheck;
      policy = found;
    } else {
      if (actor.systemRole !== SystemRole.ADMIN) {
        return forbidden("Chá»‰ admin má»›i cÃ³ quyá»n restore backup tá»± táº¡o team/policy");
      }

      const parsedMetadata = parseRestoreMetadata(parsed.metadata);
      if (parsedMetadata.errors.length > 0 || !parsedMetadata.data) {
        return badRequest("Backup CSV khÃ´ng há»£p lá»‡", parsedMetadata.errors.slice(0, MAX_ERRORS));
      }

      const restoreResult = await createPolicyFromBackupMetadata({
        actorId: actor.id,
        metadata: parsedMetadata.data,
        request: req,
      });
      if ("response" in restoreResult) {
        return restoreResult.response;
      }

      policy = restoreResult.policy;
      createdTeamId = restoreResult.createdTeamId;
      createdPolicyId = restoreResult.createdPolicyId;
      restoredFromBackup = true;
    }

    if (!policy) {
      return badRequest("KhÃ´ng xÃ¡c Ä‘á»‹nh Ä‘Æ°á»£c policy Ä‘á»ƒ import");
    }

    const selectedParticipantUserIds = await getPolicyParticipantUserIds(policy.id);
    const eligibleMembers = filterTeamMembersByPolicySelection(
      policy.team.members,
      selectedParticipantUserIds
    );
    if (eligibleMembers.length === 0) {
      return badRequest("ChÃ­nh sÃ¡ch nÃ y chÆ°a cÃ³ thÃ nh viÃªn Ã¡p dá»¥ng");
    }

    const participantSet = new Set(eligibleMembers.map((member) => member.user.id));
    const backupMap = buildDefaultBackupMap(eligibleMembers.map((member) => member.user.id));

    const teamUsers: TeamUserLite[] = policy.team.members.map((member) => ({
      id: member.user.id,
      email: member.user.email,
      fullName: member.user.fullName,
    }));
    const teamUserIndex = buildTeamUserIndex(teamUsers);
    const userLabelById = buildPolicyUserLabelById(teamUsers);

    const rowErrors: ConflictError[] = [];
    const shiftDrafts: ShiftDraft[] = [];

    for (const row of parsed.rows) {
      const startsAt = combineScheduleDateTime(row.startDateText, row.startTimeText);
      if (!startsAt) {
        pushError(
          rowErrors,
          row.line,
          `startDate/startTime \"${row.startDateText} ${row.startTimeText}\" khÃ´ng Ä‘Ãºng Ä‘á»‹nh dáº¡ng`
        );
        continue;
      }

      const endsAt = combineScheduleDateTime(row.endDateText, row.endTimeText);
      if (!endsAt) {
        pushError(
          rowErrors,
          row.line,
          `endDate/endTime \"${row.endDateText} ${row.endTimeText}\" khÃ´ng Ä‘Ãºng Ä‘á»‹nh dáº¡ng`
        );
        continue;
      }

      if (endsAt <= startsAt) {
        pushError(rowErrors, row.line, "endsAt pháº£i lá»›n hÆ¡n startsAt");
        continue;
      }

      const assignee = resolveUserFromCsv(
        row.assigneeText,
        row.line,
        "assignee",
        teamUserIndex,
        rowErrors
      );
      if (!assignee) continue;

      if (!participantSet.has(assignee.id)) {
        pushError(
          rowErrors,
          row.line,
          `assignee \"${row.assigneeText}\" chÆ°a Ä‘Æ°á»£c chá»n trong danh sÃ¡ch participant cá»§a policy`
        );
        continue;
      }

      const backupId = backupMap.get(assignee.id) ?? null;
      shiftDrafts.push({
        line: row.line,
        assigneeId: assignee.id,
        backupId: backupId === assignee.id ? null : backupId,
        startsAt,
        endsAt,
        notes: row.notes,
      });
    }

    if (rowErrors.length > 0) {
      return badRequest("CSV cÃ³ dá»¯ liá»‡u khÃ´ng há»£p lá»‡", rowErrors.slice(0, MAX_ERRORS));
    }
    if (shiftDrafts.length === 0) {
      return badRequest("CSV khÃ´ng cÃ³ ca trá»±c há»£p lá»‡ Ä‘á»ƒ import");
    }

    const timezone = policy.timezone ?? "Asia/Ho_Chi_Minh";

    const internalConflicts: ConflictError[] = [];
    const dayOwnerMap = new Map<string, ShiftDraft>();
    for (const draft of shiftDrafts) {
      const dayKeys = localDayKeysForWindow(draft.startsAt, draft.endsAt, timezone);
      for (const dayKey of dayKeys) {
        const key = `${draft.assigneeId}|${dayKey}`;
        const previous = dayOwnerMap.get(key);
        if (previous) {
          const assigneeLabel = userLabelById.get(draft.assigneeId) ?? draft.assigneeId;
          pushError(
            internalConflicts,
            draft.line,
            `assignee \"${assigneeLabel}\" trÃ¹ng ngÃ y ${dayKey} vá»›i dÃ²ng ${previous.line} (${formatRangeInTimezone(previous.startsAt, previous.endsAt, timezone)})`
          );
          break;
        }
        dayOwnerMap.set(key, draft);
      }
    }

    const draftsByAssignee = new Map<string, ShiftDraft[]>();
    for (const draft of shiftDrafts) {
      const list = draftsByAssignee.get(draft.assigneeId) ?? [];
      list.push(draft);
      draftsByAssignee.set(draft.assigneeId, list);
    }

    for (const [assigneeId, list] of draftsByAssignee.entries()) {
      const sorted = [...list].sort(
        (a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.endsAt.getTime() - b.endsAt.getTime()
      );
      for (let index = 1; index < sorted.length; index += 1) {
        const previous = sorted[index - 1];
        const current = sorted[index];
        if (overlaps(previous, current)) {
          const overlapStart = current.startsAt > previous.startsAt ? current.startsAt : previous.startsAt;
          const overlapEnd = current.endsAt < previous.endsAt ? current.endsAt : previous.endsAt;
          const assigneeLabel = userLabelById.get(assigneeId) ?? assigneeId;
          pushError(
            internalConflicts,
            current.line,
            `assignee \"${assigneeLabel}\" trÃ¹ng thá»i gian vá»›i dÃ²ng ${previous.line}: ${formatRangeInTimezone(overlapStart, overlapEnd, timezone)}`
          );
        }
      }
    }

    if (internalConflicts.length > 0) {
      return badRequest("CSV cÃ³ xung Ä‘á»™t ná»™i bá»™", internalConflicts.slice(0, MAX_ERRORS));
    }

    const rangeStart = shiftDrafts.reduce(
      (min, row) => (row.startsAt < min ? row.startsAt : min),
      shiftDrafts[0].startsAt
    );
    const rangeEnd = shiftDrafts.reduce(
      (max, row) => (row.endsAt > max ? row.endsAt : max),
      shiftDrafts[0].endsAt
    );

    const overlapBatch = await prisma.scheduleBatch.findFirst({
      where: {
        policyId: policy.id,
        status: "PUBLISHED",
        rangeStart: { lt: rangeEnd },
        rangeEnd: { gt: rangeStart },
      },
      select: { id: true },
    });
    if (overlapBatch) {
      return conflict(
        "Khoáº£ng thá»i gian import bá»‹ trÃ¹ng vá»›i batch Ä‘Ã£ publish. HÃ£y rollback/reschedule batch cÅ© trÆ°á»›c.",
        "BATCH_OVERLAP"
      );
    }

    const assigneeIds = [...new Set(shiftDrafts.map((row) => row.assigneeId))];
    const existingShifts = await prisma.shift.findMany({
      where: {
        assigneeId: { in: assigneeIds },
        status: { in: [ShiftStatus.PUBLISHED, ShiftStatus.ACTIVE, ShiftStatus.COMPLETED] },
        startsAt: { lt: rangeEnd },
        endsAt: { gt: rangeStart },
      },
      select: {
        id: true,
        assigneeId: true,
        startsAt: true,
        endsAt: true,
      },
    });

    const existingByAssignee = new Map<string, typeof existingShifts>();
    for (const existingShift of existingShifts) {
      const list = existingByAssignee.get(existingShift.assigneeId) ?? [];
      list.push(existingShift);
      existingByAssignee.set(existingShift.assigneeId, list);
    }

    const externalConflicts: ConflictError[] = [];
    for (const draft of shiftDrafts) {
      const existingForUser = existingByAssignee.get(draft.assigneeId) ?? [];
      for (const existing of existingForUser) {
        if (overlaps(existing, draft)) {
          const overlapStart = draft.startsAt > existing.startsAt ? draft.startsAt : existing.startsAt;
          const overlapEnd = draft.endsAt < existing.endsAt ? draft.endsAt : existing.endsAt;
          const assigneeLabel = userLabelById.get(draft.assigneeId) ?? draft.assigneeId;
          pushError(
            externalConflicts,
            draft.line,
            `assignee \"${assigneeLabel}\" trÃ¹ng ca Ä‘Ã£ cÃ³ tá»« ${formatRangeInTimezone(overlapStart, overlapEnd, timezone)} (ca cÅ©: ${formatRangeInTimezone(existing.startsAt, existing.endsAt, timezone)})`
          );
          break;
        }

        if (hasSharedLocalDay(existing, draft, timezone)) {
          const sharedDay = firstSharedLocalDay(existing, draft, timezone);
          const assigneeLabel = userLabelById.get(draft.assigneeId) ?? draft.assigneeId;
          pushError(
            externalConflicts,
            draft.line,
            `assignee \"${assigneeLabel}\" trÃ¹ng ngÃ y ${sharedDay ?? "?"} vá»›i ca Ä‘Ã£ cÃ³ (${formatRangeInTimezone(existing.startsAt, existing.endsAt, timezone)})`
          );
          break;
        }
      }
    }

    if (externalConflicts.length > 0) {
      return badRequest(
        "CSV bá»‹ xung Ä‘á»™t vá»›i ca trá»±c Ä‘Ã£ tá»“n táº¡i",
        externalConflicts.slice(0, MAX_ERRORS)
      );
    }

    const templateTasks = parseTemplateTasks((policy as unknown as { templateTasks?: unknown }).templateTasks);
    const minDueAt = new Date(Date.now() + 60 * 60 * 1000);

    const batch = await prisma.$transaction(async (tx) => {
      const newBatch = await tx.scheduleBatch.create({
        data: {
          policyId: policy.id,
          publishedBy: actor.id,
          rangeStart,
          rangeEnd,
          idempotencyKey: `csv-import:${policy.id}:${Date.now()}:${randomUUID()}`,
        },
      });

      await tx.shift.createMany({
        data: shiftDrafts.map((row) => ({
          policyId: policy.id,
          batchId: newBatch.id,
          assigneeId: row.assigneeId,
          backupId: row.backupId,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          status: ShiftStatus.PUBLISHED,
          source: ShiftSource.MANUAL,
          notes: row.notes ?? null,
        })),
      });

      const createdShifts = await tx.shift.findMany({
        where: { batchId: newBatch.id },
        select: { id: true, assigneeId: true, startsAt: true, endsAt: true },
      });

      await tx.shiftConfirmation.createMany({
        data: createdShifts.map((shift) => {
          const computed = computeConfirmationDueAt(
            { assigneeId: shift.assigneeId, startsAt: shift.startsAt, endsAt: shift.endsAt },
            policy.confirmationDueHours
          );
          return {
            shiftId: shift.id,
            userId: shift.assigneeId,
            dueAt: computed < minDueAt ? minDueAt : computed,
          };
        }),
      });

      if (templateTasks.length > 0) {
        await tx.shiftTask.createMany({
          data: createdShifts.flatMap((shift) =>
            templateTasks.map((title, order) => ({
              shiftId: shift.id,
              title,
              order,
            }))
          ),
        });
      }

      return newBatch;
    });

    const confirmations = await prisma.shiftConfirmation.findMany({
      where: { shift: { batchId: batch.id } },
      include: {
        shift: { select: { startsAt: true, endsAt: true } },
      },
    });
    const policyTelegramOptions = await getPolicyTelegramOptions(policy.id);

    const remindersScheduled = await scheduleAllRemindersForBatchSafe(
      confirmations.map((confirmation) => ({
        id: confirmation.id,
        shiftId: confirmation.shiftId,
        userId: confirmation.userId,
        dueAt: confirmation.dueAt,
        shift: confirmation.shift,
      })),
      { ...policy, endShiftReminderEnabled: policyTelegramOptions.endShiftReminderEnabled },
      `csv-import:${batch.id}`
    );

    const assigneeNotifications = await notifyAssigneesScheduleUpdated({
      policyName: policy.name,
      shifts: confirmations.map((confirmation) => ({
        assigneeId: confirmation.userId,
        startsAt: confirmation.shift.startsAt,
        endsAt: confirmation.shift.endsAt,
        confirmationId: confirmation.id,
      })),
      reason: "published",
    });

    await writeAuditLog({
      actorId: actor.id,
      entityType: "ScheduleBatch",
      entityId: batch.id,
      action: restoredFromBackup ? "RESTORE_IMPORT_CSV" : "IMPORT_CSV",
      newValue: {
        policyId: policy.id,
        teamId: policy.teamId,
        shiftCount: shiftDrafts.length,
        rangeStart,
        rangeEnd,
        fileName: csvFileRaw.name,
        remindersScheduled,
        createdTeamId,
        createdPolicyId,
      },
      ipAddress: req.headers.get("x-forwarded-for") ?? undefined,
    });

    return created({
      batchId: batch.id,
      policyId: policy.id,
      teamId: policy.teamId,
      importedShiftCount: shiftDrafts.length,
      rangeStart,
      rangeEnd,
      remindersScheduled,
      assigneeNotifications,
      createdTeamId,
      createdPolicyId,
      restoredFromBackup,
    });
  } catch (error) {
    return handleError(error);
  }
}
