import Link from "next/link";
import {
  endOfDay,
  format,
  isValid,
  parseISO,
  startOfDay,
} from "date-fns";
import { vi } from "date-fns/locale";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const metadata = { title: "Báo cáo Checklist" };

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string; teamId?: string }>;
}

function safeDate(value: string | undefined, fallback: Date) {
  if (!value) return fallback;
  const parsed = parseISO(value);
  return isValid(parsed) ? parsed : fallback;
}

export default async function ChecklistReportPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: {
      id: true,
      systemRole: true,
      teamMembers: { select: { teamId: true } },
    },
  });
  if (!currentUser) redirect("/login");

  const isAdmin = currentUser.systemRole === "ADMIN";
  const myTeamIds = currentUser.teamMembers.map((member) => member.teamId);
  const { from, to, teamId } = await searchParams;

  const today = new Date();
  const fallbackFrom = startOfDay(new Date(today.getFullYear(), today.getMonth(), 1));
  const fallbackTo = endOfDay(today);
  let fromDate = startOfDay(safeDate(from, fallbackFrom));
  let toDate = endOfDay(safeDate(to, fallbackTo));
  if (fromDate > toDate) {
    const temp = fromDate;
    fromDate = startOfDay(toDate);
    toDate = endOfDay(temp);
  }

  const teams = await prisma.team.findMany({
    where: isAdmin ? {} : { id: { in: myTeamIds } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const teamFilter =
    teamId ?? (!isAdmin && myTeamIds.length === 1 ? myTeamIds[0] : undefined);

  const shifts = await prisma.shift.findMany({
    where: {
      startsAt: { gte: fromDate, lte: toDate },
      ...(teamFilter
        ? { policy: { teamId: teamFilter } }
        : isAdmin
          ? {}
          : { policy: { teamId: { in: myTeamIds } } }),
    },
    include: {
      assignee: { select: { fullName: true } },
      policy: { select: { name: true, team: { select: { name: true } } } },
      tasks: { orderBy: { order: "asc" } },
    },
    orderBy: { startsAt: "asc" },
  });

  const shiftsWithTasks = shifts.filter((shift) => shift.tasks.length > 0);

  const byDay: Record<string, typeof shiftsWithTasks> = {};
  for (const shift of shiftsWithTasks) {
    const dayKey = format(shift.startsAt, "yyyy-MM-dd");
    if (!byDay[dayKey]) byDay[dayKey] = [];
    byDay[dayKey].push(shift);
  }
  const days = Object.keys(byDay).sort();

  const totalTasks = shiftsWithTasks.reduce((sum, shift) => sum + shift.tasks.length, 0);
  const doneTasks = shiftsWithTasks.reduce(
    (sum, shift) => sum + shift.tasks.filter((task) => task.isCompleted).length,
    0
  );
  const shiftsComplete = shiftsWithTasks.filter((shift) =>
    shift.tasks.every((task) => task.isCompleted)
  ).length;
  const shiftsPartial = shiftsWithTasks.filter(
    (shift) =>
      shift.tasks.some((task) => task.isCompleted) &&
      !shift.tasks.every((task) => task.isCompleted)
  ).length;
  const shiftsPending = shiftsWithTasks.filter((shift) =>
    shift.tasks.every((task) => !task.isCompleted)
  ).length;
  const completionRate =
    totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/reports" className="hover:text-gray-700">
          Báo cáo
        </Link>
        <span>/</span>
        <span className="font-medium text-gray-900">Checklist</span>
      </div>

      <div className="rounded-2xl border border-slate-700 bg-gradient-to-r from-slate-900 via-slate-900 to-indigo-900 px-6 py-5 text-white">
        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-300">
          Checklist Analytics
        </p>
        <h1 className="mt-1 text-2xl font-semibold">Báo cáo checklist theo ca</h1>
        <p className="mt-1 text-sm text-slate-300">
          Theo dõi mức độ hoàn thành checklist trước khi kết thúc ca trực.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full border border-slate-600 bg-slate-800/70 px-2.5 py-1">
            {format(fromDate, "dd/MM/yyyy")} - {format(toDate, "dd/MM/yyyy")}
          </span>
          <span className="rounded-full border border-slate-600 bg-slate-800/70 px-2.5 py-1">
            Tỷ lệ hoàn thành: {completionRate}%
          </span>
          <span className="rounded-full border border-slate-600 bg-slate-800/70 px-2.5 py-1">
            Ca có checklist: {shiftsWithTasks.length}
          </span>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <form method="GET" className="flex flex-wrap items-end gap-3">
          {(teams.length > 1 || isAdmin) && (
            <label className="min-w-[200px]">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Nhóm trực
              </span>
              <select
                name="teamId"
                defaultValue={teamFilter ?? ""}
                className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700"
              >
                <option value="">Tất cả nhóm</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label>
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Từ ngày
            </span>
            <input
              type="date"
              name="from"
              defaultValue={format(fromDate, "yyyy-MM-dd")}
              className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700"
            />
          </label>

          <label>
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Đến ngày
            </span>
            <input
              type="date"
              name="to"
              defaultValue={format(toDate, "yyyy-MM-dd")}
              className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700"
            />
          </label>

          <button
            type="submit"
            className="h-9 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Áp dụng
          </button>
        </form>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard
          label="Tổng công việc"
          value={totalTasks}
          helper={`${doneTasks} đã hoàn thành`}
          tone="indigo"
        />
        <StatCard
          label="Tỷ lệ hoàn thành"
          value={totalTasks > 0 ? `${completionRate}%` : "-"}
          helper={`${doneTasks}/${totalTasks} mục`}
          tone={completionRate >= 80 ? "green" : completionRate >= 50 ? "amber" : "rose"}
        />
        <StatCard
          label="Ca hoàn thành"
          value={shiftsComplete}
          helper={`${shiftsPartial} ca làm dở`}
          tone="green"
        />
        <StatCard
          label="Ca chưa làm"
          value={shiftsPending}
          helper={`trên ${shiftsWithTasks.length} ca có checklist`}
          tone={shiftsPending > 0 ? "rose" : "green"}
        />
      </div>

      {days.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-5 py-12 text-center text-sm text-gray-500">
          Không có ca nào có checklist trong khoảng thời gian này.
        </div>
      ) : (
        <div className="space-y-4">
          {days.map((dayKey) => {
            const dayShifts = byDay[dayKey];
            const dayTotal = dayShifts.reduce((sum, shift) => sum + shift.tasks.length, 0);
            const dayDone = dayShifts.reduce(
              (sum, shift) =>
                sum + shift.tasks.filter((task) => task.isCompleted).length,
              0
            );
            const dayRate = dayTotal > 0 ? Math.round((dayDone / dayTotal) * 100) : 0;
            const dayDate = parseISO(dayKey);

            return (
              <section
                key={dayKey}
                className="overflow-hidden rounded-2xl border border-gray-200 bg-white"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 bg-gray-50 px-5 py-3">
                  <h3 className="text-sm font-semibold text-gray-900">
                    {format(dayDate, "EEEE, dd/MM/yyyy", { locale: vi })}
                  </h3>
                  <div className="flex items-center gap-3 text-xs">
                    <div className="h-2 w-28 overflow-hidden rounded-full bg-gray-200">
                      <div
                        className={`h-full rounded-full ${dayRate >= 80 ? "bg-emerald-500" : "bg-indigo-500"}`}
                        style={{ width: `${dayRate}%` }}
                      />
                    </div>
                    <span className="font-semibold text-gray-700">
                      {dayDone}/{dayTotal} ({dayRate}%)
                    </span>
                  </div>
                </div>

                <div className="divide-y divide-gray-100">
                  {dayShifts.map((shift) => {
                    const done = shift.tasks.filter((task) => task.isCompleted).length;
                    const total = shift.tasks.length;
                    const allDone = done === total;
                    const progressTone = allDone
                      ? "bg-emerald-100 text-emerald-700"
                      : done > 0
                        ? "bg-amber-100 text-amber-700"
                        : "bg-slate-100 text-slate-600";

                    return (
                      <div key={shift.id} className="px-5 py-3">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-gray-900">
                              {shift.assignee.fullName}
                            </p>
                            <p className="truncate text-xs text-gray-500">
                              {shift.policy?.team?.name ?? "-"} · {shift.policy?.name ?? "-"}
                            </p>
                            <p className="text-xs text-gray-500">
                              {format(shift.startsAt, "HH:mm")} - {format(shift.endsAt, "HH:mm")}
                            </p>
                          </div>
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${progressTone}`}>
                            {allDone ? "Hoàn thành" : `${done}/${total}`}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 gap-1.5 lg:grid-cols-2">
                          {shift.tasks.map((task) => (
                            <div
                              key={task.id}
                              className="flex items-center gap-2 rounded-lg border border-gray-100 px-2.5 py-1.5 text-xs"
                            >
                              <span
                                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                                  task.isCompleted
                                    ? "border-emerald-500 bg-emerald-500 text-white"
                                    : "border-gray-300"
                                }`}
                              >
                                {task.isCompleted && (
                                  <svg
                                    className="h-2.5 w-2.5"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={3}
                                      d="M5 13l4 4L19 7"
                                    />
                                  </svg>
                                )}
                              </span>

                              <span
                                className={`flex-1 truncate ${
                                  task.isCompleted
                                    ? "text-gray-400 line-through"
                                    : "text-gray-700"
                                }`}
                              >
                                {task.title}
                              </span>

                              {task.isCompleted && task.completedAt && (
                                <span className="shrink-0 text-[11px] text-gray-400">
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
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  helper,
  tone,
}: {
  label: string;
  value: string | number;
  helper: string;
  tone: "indigo" | "green" | "amber" | "rose";
}) {
  const toneClass: Record<typeof tone, string> = {
    indigo: "bg-indigo-100 text-indigo-700",
    green: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-700",
    rose: "bg-rose-100 text-rose-700",
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-2 text-2xl font-bold tabular-nums text-gray-900">{value}</p>
      <p className="mt-1 text-xs text-gray-500">{helper}</p>
      <span className={`mt-3 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${toneClass[tone]}`}>
        KPI
      </span>
    </div>
  );
}
