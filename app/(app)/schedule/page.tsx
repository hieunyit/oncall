import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { ShiftStatus, TeamRole } from "@/app/generated/prisma/client";
import { startOfWeek, endOfWeek } from "date-fns";
import { ScheduleView } from "./schedule-view";

interface PageProps {
  searchParams: Promise<{ week?: string; teamId?: string }>;
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

  const { week, teamId } = await searchParams;

  const weekStart = week
    ? startOfWeek(new Date(week), { weekStartsOn: 1 })
    : startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });

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
      startsAt: { lte: weekEnd },
      endsAt: { gte: weekStart },
      status: { in: [ShiftStatus.PUBLISHED, ShiftStatus.ACTIVE, ShiftStatus.COMPLETED] },
    },
    include: {
      assignee: { select: { id: true, fullName: true } },
      policy: { select: { name: true, teamId: true } },
      confirmation: { select: { status: true, token: true } },
    },
    orderBy: { startsAt: "asc" },
  });

  const myTeams = await prisma.team.findMany({
    where: isAdmin ? {} : { members: { some: { userId: currentUser.id } } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // Team members for override modal (filtered by selected team or all accessible teams)
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
    isOverride: false,
  }));

  return (
    <div className="space-y-5">
      <ScheduleView
        weekStart={weekStart}
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
