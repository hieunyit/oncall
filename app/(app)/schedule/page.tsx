import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { ShiftStatus, TeamRole } from "@/app/generated/prisma/client";
import { startOfMonth, endOfMonth, startOfWeek, endOfWeek, parse } from "date-fns";
import { ScheduleView } from "./schedule-view";

interface PageProps {
  searchParams: Promise<{ month?: string; teamId?: string }>;
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

  const { month, teamId } = await searchParams;

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

  const teamFilter =
    teamId
      ? { policy: { teamId } }
      : isAdmin
        ? {}
        : {
            OR: [
              { assigneeId: currentUser.id },
              { policy: { team: { members: { some: { userId: currentUser.id } } } } },
            ],
          };

  const shifts = await prisma.shift.findMany({
    where: {
      ...teamFilter,
      startsAt: { lte: rangeEnd },
      endsAt: { gte: rangeStart },
      status: { in: [ShiftStatus.PUBLISHED, ShiftStatus.ACTIVE, ShiftStatus.COMPLETED] },
    },
    include: {
      assignee: { select: { id: true, fullName: true } },
      policy: { select: { name: true, teamId: true } },
      confirmation: { select: { status: true, token: true } },
      overrideForShift: { select: { id: true } },
    },
    orderBy: { startsAt: "asc" },
  });

  const myTeams = await prisma.team.findMany({
    where: isAdmin ? {} : { members: { some: { userId: currentUser.id } } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const teamMembersRaw = await prisma.teamMember.findMany({
    where: teamId
      ? { teamId }
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

  const shiftBlocks = shifts.map((s) => ({
    id: s.id,
    assigneeName: s.assignee.fullName,
    assigneeId: s.assignee.id,
    policyName: s.policy.name,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    confirmationStatus: s.confirmation?.status ?? null,
    confirmationToken: s.confirmation?.token ?? null,
    isMe: s.assignee.id === currentUser.id,
    isOverride: s.overrideForShiftId !== null,
    checklistRequired: false, // populated after migration + prisma generate
    checklistTotal: totalMap[s.id] ?? 0,
    checklistDone: doneMap[s.id] ?? 0,
  }));

  return (
    <div className="space-y-5">
      <ScheduleView
        monthStart={monthStart}
        shifts={shiftBlocks}
        currentUserId={currentUser.id}
        isManager={isManager}
        teamMembers={teamMembers}
        myTeams={myTeams}
        teamId={teamId}
      />
    </div>
  );
}
