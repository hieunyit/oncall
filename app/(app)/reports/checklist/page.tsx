import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { startOfDay, endOfDay, format, eachDayOfInterval, parseISO } from "date-fns";
import { vi } from "date-fns/locale";
import Link from "next/link";

export const metadata = { title: "Báo cáo Checklist" };

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string; teamId?: string }>;
}

export default async function ChecklistReportPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, systemRole: true, teamMembers: { select: { teamId: true } } },
  });
  if (!currentUser) redirect("/login");

  const isAdmin = currentUser.systemRole === "ADMIN";
  const myTeamIds = currentUser.teamMembers.map((m) => m.teamId);

  const { from, to, teamId } = await searchParams;

  const today = new Date();
  const fromDate = from ? startOfDay(parseISO(from)) : startOfDay(new Date(today.getFullYear(), today.getMonth(), 1));
  const toDate = to ? endOfDay(parseISO(to)) : endOfDay(today);

  const teams = await prisma.team.findMany({
    where: isAdmin ? {} : { id: { in: myTeamIds } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const teamFilter = teamId ?? (!isAdmin && myTeamIds.length === 1 ? myTeamIds[0] : undefined);

  const shifts = await prisma.shift.findMany({
    where: {
      startsAt: { gte: fromDate, lte: toDate },
      ...(teamFilter ? { policy: { teamId: teamFilter } } : isAdmin ? {} : { policy: { teamId: { in: myTeamIds } } }),
    },
    include: {
      assignee: { select: { fullName: true } },
      policy: { select: { name: true, team: { select: { name: true } } } },
      tasks: { orderBy: { order: "asc" } },
    },
    orderBy: { startsAt: "asc" },
  });

  // Only include shifts that have tasks
  const shiftsWithTasks = shifts.filter((s) => s.tasks.length > 0);

  // Group by day
  const byDay: Record<string, typeof shiftsWithTasks> = {};
  for (const s of shiftsWithTasks) {
    const dayKey = format(s.startsAt, "yyyy-MM-dd");
    if (!byDay[dayKey]) byDay[dayKey] = [];
    byDay[dayKey].push(s);
  }

  const days = Object.keys(byDay).sort();

  // Summary stats
  const totalTasks = shiftsWithTasks.reduce((n, s) => n + s.tasks.length, 0);
  const doneTasks = shiftsWithTasks.reduce((n, s) => n + s.tasks.filter((t) => t.isCompleted).length, 0);
  const shiftsComplete = shiftsWithTasks.filter((s) => s.tasks.every((t) => t.isCompleted)).length;
  const shiftsPartial = shiftsWithTasks.filter((s) => s.tasks.some((t) => t.isCompleted) && !s.tasks.every((t) => t.isCompleted)).length;
  const shiftsPending = shiftsWithTasks.filter((s) => s.tasks.every((t) => !t.isCompleted)).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/reports" className="hover:text-gray-700">Báo cáo</Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">Checklist</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Báo cáo Checklist công việc</h1>

        {/* Filters */}
        <form method="GET" className="flex flex-wrap items-center gap-2">
          {teams.length > 1 && (
            <select
              name="teamId"
              defaultValue={teamFilter ?? ""}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700"
            >
              <option value="">Tất cả nhóm</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          <input
            type="date"
            name="from"
            defaultValue={format(fromDate, "yyyy-MM-dd")}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700"
          />
          <span className="text-gray-400 text-sm">→</span>
          <input
            type="date"
            name="to"
            defaultValue={format(toDate, "yyyy-MM-dd")}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700"
          />
          <button
            type="submit"
            className="text-sm px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            Lọc
          </button>
        </form>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Tổng công việc" value={totalTasks} sub={`${doneTasks} đã hoàn thành`} color="blue" />
        <StatCard
          label="Tỷ lệ hoàn thành"
          value={totalTasks > 0 ? `${Math.round((doneTasks / totalTasks) * 100)}%` : "—"}
          sub={`${doneTasks}/${totalTasks}`}
          color={totalTasks > 0 && doneTasks === totalTasks ? "green" : "orange"}
        />
        <StatCard label="Ca hoàn thành" value={shiftsComplete} sub={`/${shiftsWithTasks.length} ca có checklist`} color="green" />
        <StatCard label="Ca chưa làm" value={shiftsPending} sub={`${shiftsPartial} ca làm một phần`} color={shiftsPending > 0 ? "red" : "green"} />
      </div>

      {/* By-day detail */}
      {days.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-12 text-center">
          <p className="text-gray-400 text-sm">Không có ca nào có checklist trong khoảng thời gian này.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {days.map((dayKey) => {
            const dayShifts = byDay[dayKey];
            const dayTotal = dayShifts.reduce((n, s) => n + s.tasks.length, 0);
            const dayDone = dayShifts.reduce((n, s) => n + s.tasks.filter((t) => t.isCompleted).length, 0);
            const dayDate = parseISO(dayKey);

            return (
              <div key={dayKey} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-5 py-3 bg-gray-50 border-b flex items-center justify-between">
                  <h3 className="font-semibold text-gray-800 text-sm">
                    {format(dayDate, "EEEE, dd/MM/yyyy", { locale: vi })}
                  </h3>
                  <div className="flex items-center gap-3">
                    <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${dayDone === dayTotal ? "bg-green-500" : "bg-indigo-500"}`}
                        style={{ width: dayTotal > 0 ? `${Math.round((dayDone / dayTotal) * 100)}%` : "0%" }}
                      />
                    </div>
                    <span className={`text-xs font-semibold ${dayDone === dayTotal ? "text-green-600" : "text-gray-600"}`}>
                      {dayDone}/{dayTotal}
                    </span>
                  </div>
                </div>

                <div className="divide-y divide-gray-50">
                  {dayShifts.map((shift) => {
                    const done = shift.tasks.filter((t) => t.isCompleted).length;
                    const total = shift.tasks.length;
                    const allDone = done === total;

                    return (
                      <div key={shift.id} className="px-5 py-3">
                        <div className="flex items-center justify-between gap-4 mb-2">
                          <div>
                            <span className="text-sm font-medium text-gray-900">{shift.assignee.fullName}</span>
                            <span className="text-xs text-gray-400 ml-2">
                              {shift.policy?.team?.name ?? "—"} · {shift.policy?.name ?? "—"}
                            </span>
                            <span className="text-xs text-gray-400 ml-2">
                              {format(shift.startsAt, "HH:mm")}–{format(shift.endsAt, "HH:mm")}
                            </span>
                          </div>
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                            allDone ? "bg-green-100 text-green-700" :
                            done > 0 ? "bg-blue-100 text-blue-700" :
                            "bg-gray-100 text-gray-500"
                          }`}>
                            {allDone ? "Hoàn thành" : done > 0 ? `${done}/${total}` : "Chưa làm"}
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                          {shift.tasks.map((task) => (
                            <div key={task.id} className="flex items-center gap-2 text-xs text-gray-600">
                              <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                                task.isCompleted ? "bg-green-500 border-green-500 text-white" : "border-gray-300"
                              }`}>
                                {task.isCompleted && (
                                  <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/>
                                  </svg>
                                )}
                              </span>
                              <span className={task.isCompleted ? "line-through text-gray-400" : ""}>{task.title}</span>
                              {task.isCompleted && task.completedAt && (
                                <span className="text-gray-400 ml-auto shrink-0">
                                  {format(task.completedAt, "HH:mm")}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub: string; color: string }) {
  const palette: Record<string, string> = {
    blue: "border-l-blue-500 text-blue-700",
    green: "border-l-green-500 text-green-700",
    orange: "border-l-orange-500 text-orange-700",
    red: "border-l-red-500 text-red-700",
  };
  return (
    <div className={`bg-white rounded-xl border border-gray-200 border-l-4 ${palette[color] ?? palette.blue} p-4`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-2xl font-bold mt-0.5 ${(palette[color] ?? "").split(" ")[1]}`}>{value}</p>
      <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
    </div>
  );
}
