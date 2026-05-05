import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, requireTeamRole, isNextResponse } from "@/lib/rbac";
import {
  badRequest,
  conflict,
  created,
  handleError,
  notFound,
  unauthorized,
} from "@/lib/api-response";
import { ShiftSource, ShiftStatus, TeamRole } from "@/app/generated/prisma/client";
import { computeConfirmationDueAt, localDayKeysForWindow } from "@/lib/rotation/engine";
import { scheduleAllRemindersForBatchSafe } from "@/lib/queue/scheduler";
import { notifyAssigneesScheduleUpdated } from "@/lib/notifications/notify-assignees";
import { writeAuditLog } from "@/lib/audit";
import {
  combineScheduleDateTime,
  normalizeScheduleIdentity,
  parseScheduleCsv,
} from "@/lib/schedule/csv-import";
import {
  filterTeamMembersByPolicySelection,
  getPolicyParticipantUserIds,
} from "@/lib/rotation/policy-participants";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";

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

function overlaps(a: ShiftWindow, b: ShiftWindow): boolean {
  return a.startsAt < b.endsAt && a.endsAt > b.startsAt;
}

function hasSharedLocalDay(a: ShiftWindow, b: ShiftWindow, timezone: string): boolean {
  const aDays = new Set(localDayKeysForWindow(a.startsAt, a.endsAt, timezone));
  return localDayKeysForWindow(b.startsAt, b.endsAt, timezone).some((day) => aDays.has(day));
}

function pushError(errors: ConflictError[], line: number, message: string): void {
  if (errors.length < MAX_ERRORS) {
    errors.push({ line, message });
  }
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
      pushError(errors, line, `${fieldLabel} "${identifier}" không thuộc team của policy`);
      return null;
    }
    return user;
  }

  const candidates = index.byName.get(normalizeScheduleIdentity(trimmed)) ?? [];
  if (candidates.length === 0) {
    pushError(errors, line, `${fieldLabel} "${identifier}" không thuộc team của policy`);
    return null;
  }
  if (candidates.length > 1) {
    pushError(
      errors,
      line,
      `${fieldLabel} "${identifier}" bị trùng tên. Vui lòng dùng email để import.`
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
    if (!policyId) return badRequest("policyId là bắt buộc");

    if (!(csvFileRaw instanceof File)) {
      return badRequest("Vui lòng chọn file CSV để import");
    }
    if (csvFileRaw.size <= 0) {
      return badRequest("File CSV rỗng");
    }
    if (csvFileRaw.size > MAX_CSV_BYTES) {
      return badRequest("File CSV vượt quá 2MB");
    }

    const policy = await prisma.rotationPolicy.findUnique({
      where: { id: policyId },
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
    });

    if (!policy) return notFound("Policy không tồn tại");
    if (!policy.isActive) {
      return conflict("Policy đang inactive. Hãy kích hoạt policy trước khi import.", "POLICY_INACTIVE");
    }

    const roleCheck = await requireTeamRole(policy.teamId, TeamRole.MANAGER);
    if (isNextResponse(roleCheck)) return roleCheck;

    const selectedParticipantUserIds = await getPolicyParticipantUserIds(policy.id);
    const eligibleMembers = filterTeamMembersByPolicySelection(
      policy.team.members,
      selectedParticipantUserIds
    );
    if (eligibleMembers.length === 0) {
      return badRequest("Chính sách này chưa có thành viên áp dụng");
    }
    const participantSet = new Set(eligibleMembers.map((member) => member.user.id));

    const csvText = await csvFileRaw.text();
    const parsed = parseScheduleCsv(csvText);
    if (parsed.errors.length > 0) {
      return badRequest(
        "CSV không hợp lệ",
        parsed.errors.slice(0, MAX_ERRORS).map((error) => ({
          line: error.line,
          field: error.field,
          message: error.message,
        }))
      );
    }

    const teamUsers: TeamUserLite[] = policy.team.members.map((member) => ({
      id: member.user.id,
      email: member.user.email,
      fullName: member.user.fullName,
    }));
    const userIndex = buildTeamUserIndex(teamUsers);

    const rowErrors: ConflictError[] = [];
    const shiftDrafts: ShiftDraft[] = [];

    for (const row of parsed.rows) {
      const startsAt = combineScheduleDateTime(row.startDateText, row.startTimeText);
      if (!startsAt) {
        pushError(
          rowErrors,
          row.line,
          `startDate/startTime "${row.startDateText} ${row.startTimeText}" không đúng định dạng`
        );
        continue;
      }

      const endsAt = combineScheduleDateTime(row.endDateText, row.endTimeText);
      if (!endsAt) {
        pushError(
          rowErrors,
          row.line,
          `endDate/endTime "${row.endDateText} ${row.endTimeText}" không đúng định dạng`
        );
        continue;
      }

      if (endsAt <= startsAt) {
        pushError(rowErrors, row.line, "endsAt phải lớn hơn startsAt");
        continue;
      }

      const assignee = resolveUserFromCsv(
        row.assigneeText,
        row.line,
        "assignee",
        userIndex,
        rowErrors
      );
      if (!assignee) continue;

      if (!participantSet.has(assignee.id)) {
        pushError(
          rowErrors,
          row.line,
          `assignee "${row.assigneeText}" chưa được chọn trong danh sách participant của policy`
        );
        continue;
      }

      let backupId: string | null = null;
      if (row.backupText) {
        const backup = resolveUserFromCsv(
          row.backupText,
          row.line,
          "backup",
          userIndex,
          rowErrors
        );
        if (!backup) continue;
        if (backup.id === assignee.id) {
          pushError(rowErrors, row.line, "backup không được trùng assignee");
          continue;
        }
        backupId = backup.id;
      }

      shiftDrafts.push({
        line: row.line,
        assigneeId: assignee.id,
        backupId,
        startsAt,
        endsAt,
        notes: row.notes,
      });
    }

    if (rowErrors.length > 0) {
      return badRequest("CSV có dữ liệu không hợp lệ", rowErrors.slice(0, MAX_ERRORS));
    }
    if (shiftDrafts.length === 0) {
      return badRequest("CSV không có ca trực hợp lệ để import");
    }

    const timezone = policy.timezone ?? "Asia/Ho_Chi_Minh";
    const internalConflicts: ConflictError[] = [];
    const localDaySet = new Set<string>();
    for (const draft of shiftDrafts) {
      const dayKeys = localDayKeysForWindow(draft.startsAt, draft.endsAt, timezone);
      for (const dayKey of dayKeys) {
        const key = `${draft.assigneeId}|${dayKey}`;
        if (localDaySet.has(key)) {
          pushError(
            internalConflicts,
            draft.line,
            "assignee bị trùng ca trong cùng ngày (theo timezone policy)"
          );
          break;
        }
        localDaySet.add(key);
      }
    }

    const draftsByAssignee = new Map<string, ShiftDraft[]>();
    for (const draft of shiftDrafts) {
      const list = draftsByAssignee.get(draft.assigneeId) ?? [];
      list.push(draft);
      draftsByAssignee.set(draft.assigneeId, list);
    }
    for (const list of draftsByAssignee.values()) {
      const sorted = [...list].sort(
        (a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.endsAt.getTime() - b.endsAt.getTime()
      );
      for (let index = 1; index < sorted.length; index += 1) {
        const previous = sorted[index - 1];
        const current = sorted[index];
        if (overlaps(previous, current)) {
          pushError(internalConflicts, current.line, "assignee bị chồng thời gian giữa các dòng CSV");
        }
      }
    }

    if (internalConflicts.length > 0) {
      return badRequest("CSV có xung đột nội bộ", internalConflicts.slice(0, MAX_ERRORS));
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
        policyId,
        status: "PUBLISHED",
        rangeStart: { lt: rangeEnd },
        rangeEnd: { gt: rangeStart },
      },
      select: { id: true },
    });
    if (overlapBatch) {
      return conflict(
        "Khoảng thời gian import bị trùng với batch đã publish. Hãy rollback/reschedule batch cũ trước.",
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
        if (
          overlaps(existing, draft) ||
          hasSharedLocalDay(existing, draft, timezone)
        ) {
          pushError(
            externalConflicts,
            draft.line,
            "assignee đã có ca trực khác bị trùng thời gian hoặc trùng ngày"
          );
          break;
        }
      }
    }

    if (externalConflicts.length > 0) {
      return badRequest(
        "CSV bị xung đột với ca trực đã tồn tại",
        externalConflicts.slice(0, MAX_ERRORS)
      );
    }

    const templateTasks = parseTemplateTasks((policy as unknown as { templateTasks?: unknown }).templateTasks);
    const minDueAt = new Date(Date.now() + 60 * 60 * 1000);

    const batch = await prisma.$transaction(async (tx) => {
      const newBatch = await tx.scheduleBatch.create({
        data: {
          policyId,
          publishedBy: actor.id,
          rangeStart,
          rangeEnd,
          idempotencyKey: `csv-import:${policyId}:${Date.now()}:${randomUUID()}`,
        },
      });

      await tx.shift.createMany({
        data: shiftDrafts.map((row) => ({
          policyId,
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

    const remindersScheduled = await scheduleAllRemindersForBatchSafe(
      confirmations.map((confirmation) => ({
        id: confirmation.id,
        shiftId: confirmation.shiftId,
        userId: confirmation.userId,
        dueAt: confirmation.dueAt,
        shift: confirmation.shift,
      })),
      policy,
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
      action: "IMPORT_CSV",
      newValue: {
        policyId,
        shiftCount: shiftDrafts.length,
        rangeStart,
        rangeEnd,
        fileName: csvFileRaw.name,
        remindersScheduled,
      },
      ipAddress: req.headers.get("x-forwarded-for") ?? undefined,
    });

    return created({
      batchId: batch.id,
      policyId,
      importedShiftCount: shiftDrafts.length,
      rangeStart,
      rangeEnd,
      remindersScheduled,
      assigneeNotifications,
    });
  } catch (error) {
    return handleError(error);
  }
}
