import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { startOfMonth, endOfMonth, subMonths, format } from "date-fns";
import { vi } from "date-fns/locale";
import { AlertStatus } from "@/app/generated/prisma/client";
import { ReportsFilters } from "./reports-filters";

export const metadata = { title: "Báo cáo" };

interface PageProps {
  searchParams: Promise<{ month?: string; teamId?: string }>;
}

export default async function ReportsPage({ searchParams }: PageProps) {
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

  const { month, teamId } = await searchParams;
  const isAdmin = currentUser.systemRole === "ADMIN";
  const myTeamIds = currentUser.teamMembers.map((m) => m.teamId);

  const selectedDate = month ? new Date(month + "-01") : new Date();
  const monthStart = startOfMonth(selectedDate);
  const monthEnd = endOfMonth(selectedDate);
  const selectedMonth = format(selectedDate, "yyyy-MM");

  const monthOptions = Array.from({ length: 6 }, (_, i) => {
    const d = subMonths(new Date(), i);
    return { value: format(d, "yyyy-MM"), label: format(d, "MMMM yyyy", { locale: vi }) };
  });

  const teams = await prisma.team.findMany({
    where: isAdmin ? {} : { id: { in: myTeamIds } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const teamFilter = teamId || (!isAdmin && myTeamIds.length === 1 ? myTeamIds[0] : undefined);

  const teamWhereShift = teamFilter
    ? { policy: { teamId: teamFilter } }
    : isAdmin ? {} : { policy: { teamId: { in: myTeamIds } } };

  const teamWhereAlert = teamFilter
    ? { integration: { teamId: teamFilter } }
    : isAdmin ? {} : { integration: { teamId: { in: myTeamIds } } };

  const teamWhereSwap = teamFilter
    ? { requesterShift: { policy: { teamId: teamFilter } } }
    : isAdmin ? {} : { requesterShift: { policy: { teamId: { in: myTeamIds } } } };

  const [shiftStats, confirmationStats, swapStats, alertStats, ackedAlerts] = await Promise.all([
    prisma.shift.groupBy({
      by: ["assigneeId"],
      where: {
        startsAt: { gte: monthStart, lte: monthEnd },
        overrideForShiftId: null,
        ...teamWhereShift,
      },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    }),
    prisma.shiftConfirmation.groupBy({
      by: ["status"],
      where: {
        shift: { startsAt: { gte: monthStart, lte: monthEnd }, ...teamWhereShift },
      },
      _count: { id: true },
    }),
    prisma.swapRequest.groupBy({
      by: ["status"],
      where: { createdAt: { gte: monthStart, lte: monthEnd }, ...teamWhereSwap },
      _count: { id: true },
    }),
    prisma.alert.groupBy({
      by: ["status"],
      where: { triggeredAt: { gte: monthStart, lte: monthEnd }, ...teamWhereAlert },
      _count: { id: true },
    }),
    prisma.alert.findMany({
      where: {
        status: { in: [AlertStatus.ACKNOWLEDGED, AlertStatus.RESOLVED] },
        acknowledgedAt: { not: null },
        triggeredAt: { gte: monthStart, lte: monthEnd },
        ...teamWhereAlert,
      },
      select: { triggeredAt: true, acknowledgedAt: true },
    }),
  ]);

  const userIds = shiftStats.map((s) => s.assigneeId);
  const usersMap =
    userIds.length > 0
      ? Object.fromEntries(
          (
            await prisma.user.findMany({
              where: { id: { in: userIds } },
              select: { id: true, fullName: true },
            })
          ).map((u) => [u.id, u])
        )
      : {};

  const confirmMap = Object.fromEntries(confirmationStats.map((r) => [r.status, r._count.id]));
  const confirmTotal = confirmationStats.reduce((s, r) => s + r._count.id, 0);

  const swapMap = Object.fromEntries(swapStats.map((r) => [r.status, r._count.id]));
  const swapTotal = swapStats.reduce((s, r) => s + r._count.id, 0);

  const alertMap = Object.fromEntries(alertStats.map((r) => [r.status, r._count.id]));
  const alertTotal = alertStats.reduce((s, r) => s + r._count.id, 0);

  const avgAckMs =
    ackedAlerts.length > 0
      ? ackedAlerts.reduce(
          (sum, a) => sum + (a.acknowledgedAt!.getTime() - a.triggeredAt.getTime()),
          0
        ) / ackedAlerts.length
      : null;

  const formatDuration = (ms: number) => {
    const mins = Math.round(ms / 60000);
    if (mins < 60) return `${mins} phút`;
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
  };

  const totalShifts = shiftStats.reduce((s, r) => s + r._count.id, 0);
  const maxShiftCount = shiftStats[0]?._count.id ?? 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Báo cáo</h1>
        <ReportsFilters
          monthOptions={monthOptions}
          selectedMonth={selectedMonth}
          teams={teams}
          selectedTeamId={teamFilter}
          showAllTeams={isAdmin}
        />
      </div>

      <p className="text-sm text-gray-500 -mt-3">
        {format(monthStart, "dd/MM/yyyy", { locale: vi })} –{" "}
        {format(monthEnd, "dd/MM/yyyy", { locale: vi })}
        {teamFilter && teams.find((t) => t.id === teamFilter) && (
          <> · <span className="font-medium text-gray-700">{teams.find((t) => t.id === teamFilter)!.name}</span></>
        )}
      </p>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          label="Tổng ca trực"
          value={totalShifts}
          color="blue"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          }
        />
        <SummaryCard
          label="Tổng alerts"
          value={alertTotal}
          color={alertTotal > 0 ? "red" : "green"}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          }
        />
        <SummaryCard
          label="Yêu cầu đổi ca"
          value={swapTotal}
          color="orange"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
          }
        />
        <SummaryCard
          label="Avg ack time"
          value={avgAckMs !== null ? formatDuration(avgAckMs) : "—"}
          color="purple"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Shift count per person */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900 text-sm">Số ca trực theo người</h2>
          </div>
          {shiftStats.length === 0 ? (
            <p className="px-5 py-8 text-center text-gray-400 text-sm">Không có dữ liệu.</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {shiftStats.map((s) => {
                const user = usersMap[s.assigneeId];
                const pct = Math.round((s._count.id / maxShiftCount) * 100);
                const totalPct = totalShifts > 0 ? Math.round((s._count.id / totalShifts) * 100) : 0;
                return (
                  <div key={s.assigneeId} className="px-5 py-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm text-gray-700 font-medium">{user?.fullName ?? s.assigneeId}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400">{totalPct}%</span>
                        <span className="text-sm font-bold text-gray-900">{s._count.id} ca</span>
                      </div>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-500 rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Alert breakdown */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900 text-sm">Phân tích Alerts</h2>
          </div>
          <div className="px-5 py-4 space-y-3">
            <StatRow label="Tổng alerts" value={alertTotal} />
            <StatRow label="Đang cháy" value={alertMap["FIRING"] ?? 0} valueClass="text-red-600 font-bold" dotClass="bg-red-500" />
            <StatRow label="Đã nhận" value={alertMap["ACKNOWLEDGED"] ?? 0} valueClass="text-yellow-600" dotClass="bg-yellow-500" />
            <StatRow label="Đã giải quyết" value={alertMap["RESOLVED"] ?? 0} valueClass="text-green-600" dotClass="bg-green-500" />
            <StatRow
              label="Tỷ lệ giải quyết"
              value={alertTotal > 0 ? `${Math.round(((alertMap["RESOLVED"] ?? 0) / alertTotal) * 100)}%` : "—"}
            />
            {avgAckMs !== null && (
              <StatRow label="Avg ack time" value={formatDuration(avgAckMs)} />
            )}
          </div>
        </div>

        {/* Confirmation stats */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900 text-sm">Xác nhận ca trực</h2>
          </div>
          <div className="px-5 py-4 space-y-3">
            <StatRow label="Tổng xác nhận" value={confirmTotal} />
            <StatRow label="Đã xác nhận" value={confirmMap["CONFIRMED"] ?? 0} valueClass="text-green-600" dotClass="bg-green-500" />
            <StatRow label="Chờ xác nhận" value={confirmMap["PENDING"] ?? 0} valueClass="text-yellow-600" dotClass="bg-yellow-500" />
            <StatRow label="Từ chối" value={confirmMap["DECLINED"] ?? 0} valueClass="text-red-600" dotClass="bg-red-500" />
            <StatRow label="Hết hạn" value={confirmMap["EXPIRED"] ?? 0} valueClass="text-gray-400" dotClass="bg-gray-300" />
            <StatRow
              label="Tỷ lệ xác nhận"
              value={confirmTotal > 0 ? `${Math.round(((confirmMap["CONFIRMED"] ?? 0) / confirmTotal) * 100)}%` : "—"}
            />
          </div>
        </div>

        {/* Swap stats */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900 text-sm">Đổi ca</h2>
          </div>
          <div className="px-5 py-4 space-y-3">
            <StatRow label="Tổng yêu cầu" value={swapTotal} />
            <StatRow label="Đang chờ" value={swapMap["REQUESTED"] ?? 0} valueClass="text-yellow-600" dotClass="bg-yellow-500" />
            <StatRow
              label="Chờ admin duyệt"
              value={swapMap["ACCEPTED_BY_TARGET"] ?? 0}
              valueClass="text-blue-600"
              dotClass="bg-blue-500"
            />
            <StatRow label="Đã duyệt" value={swapMap["APPROVED"] ?? 0} valueClass="text-green-600" dotClass="bg-green-500" />
            <StatRow
              label="Từ chối"
              value={swapMap["REJECTED"] ?? 0}
              valueClass="text-red-600"
              dotClass="bg-red-500"
            />
            <StatRow label="Đã hủy" value={swapMap["CANCELLED"] ?? 0} valueClass="text-gray-400" dotClass="bg-gray-300" />
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: number | string;
  color: string;
  icon: React.ReactNode;
}) {
  const palette: Record<string, { border: string; bg: string; icon: string; value: string }> = {
    blue:   { border: "border-l-blue-500",   bg: "bg-blue-50",   icon: "text-blue-500",   value: "text-blue-700"   },
    green:  { border: "border-l-green-500",  bg: "bg-green-50",  icon: "text-green-500",  value: "text-green-700"  },
    red:    { border: "border-l-red-500",    bg: "bg-red-50",    icon: "text-red-500",    value: "text-red-700"    },
    orange: { border: "border-l-orange-500", bg: "bg-orange-50", icon: "text-orange-500", value: "text-orange-700" },
    purple: { border: "border-l-purple-500", bg: "bg-purple-50", icon: "text-purple-500", value: "text-purple-700" },
  };
  const p = palette[color] ?? palette.blue;
  return (
    <div className={`bg-white rounded-xl border border-gray-200 border-l-4 ${p.border} p-5 flex items-start gap-3`}>
      <div className={`w-9 h-9 rounded-lg ${p.bg} flex items-center justify-center shrink-0 ${p.icon}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500 leading-tight">{label}</p>
        <p className={`text-2xl font-bold mt-0.5 ${p.value}`}>{value}</p>
      </div>
    </div>
  );
}

function StatRow({
  label,
  value,
  valueClass,
  dotClass,
}: {
  label: string;
  value: number | string;
  valueClass?: string;
  dotClass?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        {dotClass && <span className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`} />}
        <span className="text-sm text-gray-500">{label}</span>
      </div>
      <span className={`text-sm font-semibold tabular-nums ${valueClass ?? "text-gray-900"}`}>{value}</span>
    </div>
  );
}
