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
      policy: { select: { name: true, teamId: true, checklistRequired: true } as any },
      confirmation: { select: { status: true, token: true } },
      overrideForShift: { select: { id: true } },
      _count: { select: { tasks: true } },
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

  // Count completed tasks per shift
  const shiftIds = shifts.map((s) => s.id);
  const doneCounts = await prisma.shiftTask.groupBy({
    by: ["shiftId"],
    where: { shiftId: { in: shiftIds }, isCompleted: true },
    _count: { id: true },
  });
  const doneMap = Object.fromEntries(doneCounts.map((r) => [r.shiftId, r._count.id]));

  const shiftBlocks = shifts.map((s) => {
    const shift = s as any;
    return {
      id: s.id,
      assigneeName: shift.assignee.fullName as string,
      assigneeId: shift.assignee.id as string,
      policyName: shift.policy.name as string,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      confirmationStatus: shift.confirmation?.status ?? null,
      confirmationToken: shift.confirmation?.token ?? null,
      isMe: shift.assignee.id === currentUser.id,
      isOverride: s.overrideForShiftId !== null,
      checklistRequired: shift.policy.checklistRequired as boolean,
      checklistTotal: shift._count.tasks as number,
      checklistDone: doneMap[s.id] ?? 0,
    };
  });

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
