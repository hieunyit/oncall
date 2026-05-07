import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { TeamRole } from "@/app/generated/prisma/client";
import { startOfMonth, endOfMonth, startOfWeek, endOfWeek, parse } from "date-fns";
import { ScheduleView } from "./schedule-view";
import type { ShiftBlock } from "./schedule-view";
import { buildScheduleShiftWhere } from "@/lib/schedule/filters";

interface PageProps {
  searchParams: Promise<{ month?: string; teamId?: string; policyId?: string }>;
}

export const metadata = { title: "Lịch trực" };

export default async function SchedulePage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: {
      id: true,
      systemRole: true,
      teamMembers: { select: { role: true, teamId: true } },
    },
  });
  if (!currentUser) redirect("/login");

  const { month, teamId, policyId } = await searchParams;

  const baseDate = month
    ? parse(month, "yyyy-MM", new Date())
    : new Date();
  const monthStart = startOfMonth(baseDate);
  // Query range: from Monday of first week to Sunday of last week (to fill grid)
  const rangeStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const rangeEnd = endOfWeek(endOfMonth(monthStart), { weekStartsOn: 1 });

  const isAdmin = currentUser.systemRole === "ADMIN";
  const managedTeamIds = currentUser.teamMembers
    .filter((m) => m.role === TeamRole.MANAGER)
    .map((m) => m.teamId);
  const isManager = isAdmin || managedTeamIds.length > 0;

  const myTeams = await prisma.team.findMany({
    where: isAdmin ? {} : { members: { some: { userId: currentUser.id } } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const selectedTeamId =
    teamId && (isAdmin || myTeams.some((team) => team.id === teamId))
      ? teamId
      : undefined;

  const shiftWhere = buildScheduleShiftWhere({
    teamId: selectedTeamId,
    policyId,
    isAdmin,
    currentUserId: currentUser.id,
    rangeStart,
    rangeEnd,
  });

  const shifts = await prisma.shift.findMany({
    where: shiftWhere,
    include: {
      assignee: { select: { id: true, fullName: true, email: true } },
      backup: { select: { id: true, fullName: true } },
      policy: { select: { name: true, teamId: true, team: { select: { name: true } } } },
      confirmation: { select: { status: true, token: true, dueAt: true, respondedAt: true } },
      overrideForShift: { select: { id: true } },
    },
    orderBy: { startsAt: "asc" },
  });

  const policyOptions = await prisma.rotationPolicy.findMany({
    where: {
      isActive: true,
      ...(selectedTeamId
        ? { teamId: selectedTeamId }
        : isAdmin
          ? {}
          : { teamId: { in: myTeams.map((team) => team.id) } }),
    },
    select: { id: true, name: true, teamId: true },
    orderBy: [{ teamId: "asc" }, { name: "asc" }],
  });

  const teamMembersRaw = await prisma.teamMember.findMany({
    where: selectedTeamId
      ? { teamId: selectedTeamId }
      : isAdmin
        ? {}
        : { teamId: { in: myTeams.map((t) => t.id) } },
    include: { user: { select: { id: true, fullName: true } } },
    distinct: ["userId"],
  });
  const teamMembers = teamMembersRaw.map((m) => ({
    id: m.user.id,
    fullName: m.user.fullName,
  }));

  // Count tasks per shift — only when shift_tasks table exists (after migration)
  let totalMap: Record<string, number> = {};
  let doneMap: Record<string, number> = {};
  try {
    const shiftIds = shifts.map((s) => s.id);
    const [totalCounts, doneCounts] = await Promise.all([
      prisma.shiftTask.groupBy({
        by: ["shiftId"],
        where: { shiftId: { in: shiftIds } },
        _count: { id: true },
      }),
      prisma.shiftTask.groupBy({
        by: ["shiftId"],
        where: { shiftId: { in: shiftIds }, isCompleted: true },
        _count: { id: true },
      }),
    ]);
    totalMap = Object.fromEntries(totalCounts.map((r) => [r.shiftId, r._count.id]));
    doneMap = Object.fromEntries(doneCounts.map((r) => [r.shiftId, r._count.id]));
  } catch {
    // shift_tasks table not yet created — checklist counts will be 0
  }

  // Load checklistRequired per policy via raw SQL (field added in migration 4)
  let checklistRequiredByPolicy: Record<string, boolean> = {};
  try {
    const policyIds = [...new Set(shifts.map((s) => s.policyId))];
    if (policyIds.length > 0) {
      const rows = await prisma.$queryRaw<Array<{ id: string; checklist_required: boolean }>>`
        SELECT id::text, checklist_required
        FROM rotation_policies
        WHERE id = ANY(${policyIds}::uuid[])
      `;
      checklistRequiredByPolicy = Object.fromEntries(
        rows.map((r) => [r.id, r.checklist_required ?? false])
      );
    }
  } catch {
    // migration 4 not yet applied
  }

  type ShiftProofRow = {
    shift_id: string;
    kind: string;
    storage_path: string;
    created_at: Date;
  };
  const latestProofByShift = new Map<string, { checkIn?: ShiftProofRow; checkOut?: ShiftProofRow }>();
  try {
    const shiftIds = shifts.map((shift) => shift.id);
    if (shiftIds.length > 0) {
      const proofRows = await prisma.$queryRaw<Array<ShiftProofRow>>`
        SELECT DISTINCT ON (shift_id, kind)
          shift_id::text,
          kind,
          storage_path,
          created_at
        FROM shift_verification_photos
        WHERE shift_id = ANY(${shiftIds}::uuid[])
          AND kind IN ('CHECK_IN', 'CHECK_OUT')
        ORDER BY shift_id, kind, created_at DESC
      `;

      for (const row of proofRows) {
        const current = latestProofByShift.get(row.shift_id) ?? {};
        if (row.kind === "CHECK_IN") current.checkIn = row;
        if (row.kind === "CHECK_OUT") current.checkOut = row;
        latestProofByShift.set(row.shift_id, current);
      }
    }
  } catch {
    // shift_verification_photos table not yet created
  }

  const shiftBlocks: ShiftBlock[] = shifts
    .filter((s) => s.policy != null)
    .map((s) => {
      const latestProof = latestProofByShift.get(s.id);
      const checkInPhoto = latestProof?.checkIn;
      const checkOutPhoto = latestProof?.checkOut;

      return {
        id: s.id,
        assigneeName: s.assignee.fullName,
        assigneeId: s.assignee.id,
        assigneeEmail: s.assignee.email,
        policyId: s.policyId,
        teamId: s.policy?.teamId ?? "",
        teamName: s.policy?.team?.name ?? null,
        policyName: s.policy?.name ?? "",
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        status: s.status,
        source: s.source,
        confirmationStatus: s.confirmation?.status ?? null,
        confirmationToken: s.confirmation?.token ?? null,
        confirmationDueAt: s.confirmation?.dueAt ?? null,
        confirmationRespondedAt: s.confirmation?.respondedAt ?? null,
        isMe: s.assignee.id === currentUser.id,
        isOverride: s.overrideForShiftId !== null,
        backupName: s.backup?.fullName ?? null,
        notes: s.notes ?? null,
        checklistRequired: checklistRequiredByPolicy[s.policyId] ?? false,
        checklistTotal: totalMap[s.id] ?? 0,
        checklistDone: doneMap[s.id] ?? 0,
        checkInAt: checkInPhoto?.created_at ?? null,
        checkOutAt: checkOutPhoto?.created_at ?? null,
        checkInPhotoPath: checkInPhoto?.storage_path ?? null,
        checkOutPhotoPath: checkOutPhoto?.storage_path ?? null,
      };
    });

  return (
    <ScheduleView
      monthStart={monthStart}
      shifts={shiftBlocks}
      currentUserId={currentUser.id}
      isManager={isManager}
      canRestoreBackup={isAdmin}
      teamMembers={teamMembers}
      myTeams={myTeams}
      teamId={selectedTeamId}
      policyId={policyId}
      policyOptions={policyOptions}
    />
  );
}
