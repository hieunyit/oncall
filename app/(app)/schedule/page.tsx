import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { ShiftStatus } from "@/app/generated/prisma/client";
import { addDays, startOfWeek, endOfWeek } from "date-fns";
import { WeekCalendar } from "@/components/schedule/week-calendar";
import { WeekNav } from "@/components/schedule/week-nav";

interface PageProps {
  searchParams: Promise<{ week?: string; teamId?: string }>;
}

export default async function SchedulePage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, systemRole: true },
  });
  if (!currentUser) redirect("/login");

  const { week, teamId } = await searchParams;

  const weekStart = week
    ? startOfWeek(new Date(week), { weekStartsOn: 1 })
    : startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });

  // Team filter — admins can see all, members see their teams
  const teamFilter =
    teamId
      ? { policy: { teamId } }
      : currentUser.systemRole === "ADMIN"
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
      policy: { select: { name: true } },
      confirmation: { select: { status: true, token: true } },
    },
    orderBy: { startsAt: "asc" },
  });

  // User's teams for filter dropdown
  const myTeams = await prisma.team.findMany({
    where:
      currentUser.systemRole === "ADMIN"
        ? {}
        : { members: { some: { userId: currentUser.id } } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

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
  }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900">Lịch trực</h1>
        <div className="flex items-center gap-3">
          {/* Team filter */}
          {myTeams.length > 0 && (
            <form>
              <select
                name="teamId"
                defaultValue={teamId ?? ""}
                onChange={(e) => {
                  const url = new URL(window.location.href);
                  if (e.target.value) url.searchParams.set("teamId", e.target.value);
                  else url.searchParams.delete("teamId");
                  window.location.href = url.toString();
                }}
                className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700"
              >
                <option value="">Tất cả nhóm</option>
                {myTeams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </form>
          )}
          <WeekNav weekStart={weekStart} />
        </div>
      </div>

      <WeekCalendar
        weekStart={weekStart}
        shifts={shiftBlocks}
        currentUserId={currentUser.id}
      />

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-green-200 inline-block" /> Đã xác nhận
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-yellow-200 inline-block" /> Chờ xác nhận
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-blue-200 inline-block" /> Ca của tôi
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-red-200 inline-block" /> Từ chối
        </span>
      </div>
    </div>
  );
}
