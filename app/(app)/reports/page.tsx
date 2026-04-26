import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { startOfMonth, endOfMonth, subMonths, format, eachDayOfInterval, getDay } from "date-fns";
import { vi } from "date-fns/locale";
import { AlertStatus, ShiftSource } from "@/app/generated/prisma/client";
import { ReportsFilters } from "./reports-filters";
import Link from "next/link";

export const metadata = { title: "Báo cáo" };

interface PageProps {
  searchParams: Promise<{ month?: string; teamId?: string; policyId?: string }>;
}

export default async function ReportsPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, systemRole: true, teamMembers: { select: { teamId: true } } },
  });
  if (!currentUser) redirect("/login");

  const { month, teamId, policyId } = await searchParams;
  const isAdmin = currentUser.systemRole === "ADMIN";
  const myTeamIds = currentUser.teamMembers.map((m) => m.teamId);

  const selectedDate = month ? new Date(month + "-01") : new Date();
  const monthStart = startOfMonth(selectedDate);
  const monthEnd = endOfMonth(selectedDate);
  const selectedMonth = format(selectedDate, "yyyy-MM");

  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const d = subMonths(new Date(), i);
    return { value: format(d, "yyyy-MM"), label: format(d, "MMMM yyyy", { locale: vi }) };
  });

  const [teams, policies] = await Promise.all([
    prisma.team.findMany({
      where: isAdmin ? {} : { id: { in: myTeamIds } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.rotationPolicy.findMany({
      where: isAdmin ? { isActive: true } : { teamId: { in: myTeamIds }, isActive: true },
      select: { id: true, name: true, teamId: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const teamFilter = teamId || (!isAdmin && myTeamIds.length === 1 ? myTeamIds[0] : undefined);

  // Build shift where clause
  const shiftWhere = {
    startsAt: { gte: monthStart, lte: monthEnd },
    overrideForShiftId: null,
    ...(policyId
      ? { policyId }
      : teamFilter
        ? { policy: { teamId: teamFilter } }
        : isAdmin ? {} : { policy: { teamId: { in: myTeamIds } } }),
  };

  const alertTeamWhere = teamFilter
    ? { integration: { teamId: teamFilter } }
    : isAdmin ? {} : { integration: { teamId: { in: myTeamIds } } };

  const [
    shiftsByPerson,
    shiftsByPolicy,
    confirmationsByPerson,
    checklistTotal,
    checklistDone,
    overrideCount,
    swapStats,
    swapsByPerson,
    alertStats,
    ackedAlerts,
    allShiftsForCoverage,
  ] = await Promise.all([
    // shifts per assignee
    prisma.shift.groupBy({
      by: ["assigneeId"],
      where: shiftWhere,
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    }),
    // shifts per policy
    prisma.shift.groupBy({
      by: ["policyId"],
      where: shiftWhere,
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    }),
    // confirmation status per user
    prisma.shiftConfirmation.findMany({
      where: { shift: shiftWhere },
      select: { userId: true, status: true },
    }),
    // checklist total tasks
    prisma.shiftTask.count({ where: { shift: shiftWhere } }),
    // checklist done tasks
    prisma.shiftTask.count({ where: { isCompleted: true, shift: shiftWhere } }),
    // override count
    prisma.shift.count({
      where: {
        source: ShiftSource.OVERRIDE,
        startsAt: { gte: monthStart, lte: monthEnd },
        ...(policyId ? { policyId } : teamFilter ? { policy: { teamId: teamFilter } } : isAdmin ? {} : { policy: { teamId: { in: myTeamIds } } }),
      },
    }),
    // swap status breakdown
    prisma.swapRequest.groupBy({
      by: ["status"],
      where: {
        createdAt: { gte: monthStart, lte: monthEnd },
        ...(teamFilter ? { originalShift: { policy: { teamId: teamFilter } } } : isAdmin ? {} : { originalShift: { policy: { teamId: { in: myTeamIds } } } }),
      },
      _count: { id: true },
    }),
    // swaps per requester
    prisma.swapRequest.groupBy({
      by: ["requesterId"],
      where: {
        createdAt: { gte: monthStart, lte: monthEnd },
        ...(teamFilter ? { originalShift: { policy: { teamId: teamFilter } } } : isAdmin ? {} : { originalShift: { policy: { teamId: { in: myTeamIds } } } }),
      },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 5,
    }),
    // alert status breakdown
    prisma.alert.groupBy({
      by: ["status"],
      where: { triggeredAt: { gte: monthStart, lte: monthEnd }, ...alertTeamWhere },
      _count: { id: true },
    }),
    // acked alerts for MTTR
    prisma.alert.findMany({
      where: { status: { in: [AlertStatus.ACKNOWLEDGED, AlertStatus.RESOLVED] }, acknowledgedAt: { not: null }, triggeredAt: { gte: monthStart, lte: monthEnd }, ...alertTeamWhere },
      select: { triggeredAt: true, acknowledgedAt: true },
    }),
    // all shift start dates for coverage gap calculation (only weekdays)
    prisma.shift.findMany({
      where: { ...shiftWhere },
      select: { startsAt: true },
    }),
  ]);

  // ── Resolve names ──────────────────────────────────────────────────────────
  const allUserIds = [
    ...new Set([
      ...shiftsByPerson.map((s) => s.assigneeId),
      ...confirmationsByPerson.map((c) => c.userId),
      ...swapsByPerson.map((s) => s.requesterId),
    ]),
  ];
  const usersMap: Record<string, { fullName: string }> =
    allUserIds.length > 0
      ? Object.fromEntries(
          (await prisma.user.findMany({ where: { id: { in: allUserIds } }, select: { id: true, fullName: true } }))
            .map((u) => [u.id, u])
        )
      : {};

  const policyIds = shiftsByPolicy.map((s) => s.policyId);
  const policiesMap: Record<string, { name: string; teamId: string; team?: { name: string } }> =
    policyIds.length > 0
      ? Object.fromEntries(
          (await prisma.rotationPolicy.findMany({
            where: { id: { in: policyIds } },
            select: { id: true, name: true, teamId: true, team: { select: { name: true } } },
          })).map((p) => [p.id, p])
        )
      : {};

  // ── Derived stats ──────────────────────────────────────────────────────────
  const totalShifts = shiftsByPerson.reduce((n, r) => n + r._count.id, 0);
  const maxShiftCount = shiftsByPerson[0]?._count.id ?? 1;

  // Confirmation per person map: userId → { CONFIRMED, PENDING, DECLINED, EXPIRED }
  const confirmByUser: Record<string, Record<string, number>> = {};
  for (const c of confirmationsByPerson) {
    if (!confirmByUser[c.userId]) confirmByUser[c.userId] = {};
    confirmByUser[c.userId][c.status] = (confirmByUser[c.userId][c.status] ?? 0) + 1;
  }
  const confirmTotal = confirmationsByPerson.length;
  const confirmConfirmed = confirmationsByPerson.filter((c) => c.status === "CONFIRMED").length;
  const confirmPending = confirmationsByPerson.filter((c) => c.status === "PENDING").length;
  const confirmDeclined = confirmationsByPerson.filter((c) => c.status === "DECLINED").length;
  const confirmExpired = confirmationsByPerson.filter((c) => c.status === "EXPIRED").length;

  const swapMap = Object.fromEntries(swapStats.map((r) => [r.status, r._count.id]));
  const swapTotal = swapStats.reduce((n, r) => n + r._count.id, 0);
  const alertMap = Object.fromEntries(alertStats.map((r) => [r.status, r._count.id]));
  const alertTotal = alertStats.reduce((n, r) => n + r._count.id, 0);

  const avgAckMs =
    ackedAlerts.length > 0
      ? ackedAlerts.reduce((sum, a) => sum + (a.acknowledgedAt!.getTime() - a.triggeredAt.getTime()), 0) / ackedAlerts.length
      : null;

  // Coverage gap: weekdays in month with no shift starting on that date (Vietnam time)
  const toVNDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(d);
  const coveredDays = new Set(allShiftsForCoverage.map((s) => toVNDay(s.startsAt)));
  const allWeekdays = eachDayOfInterval({ start: monthStart, end: monthEnd }).filter(
    (d) => { const dow = getDay(d); return dow !== 0 && dow !== 6; }
  );
  const coverageGaps = allWeekdays.filter((d) => !coveredDays.has(format(d, "yyyy-MM-dd")));

  const formatDuration = (ms: number) => {
    const mins = Math.round(ms / 60000);
    if (mins < 60) return `${mins} phút`;
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem > 0 ? `${hrs}g${rem}p` : `${hrs}h`;
  };

  const confirmRate = confirmTotal > 0 ? Math.round((confirmConfirmed / confirmTotal) * 100) : null;
  const checklistRate = checklistTotal > 0 ? Math.round((checklistDone / checklistTotal) * 100) : null;
  const selectedTeamName = teams.find((t) => t.id === teamFilter)?.name;
  const selectedPolicyName = policies.find((p) => p.id === policyId)?.name;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Báo cáo</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {format(monthStart, "MMMM yyyy", { locale: vi })}
            {selectedTeamName && <> · <span className="font-medium text-gray-700">{selectedTeamName}</span></>}
            {selectedPolicyName && <> · <span className="font-medium text-indigo-700">{selectedPolicyName}</span></>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ReportsFilters
            monthOptions={monthOptions}
            selectedMonth={selectedMonth}
            teams={teams}
            policies={policies.map((p) => ({ id: p.id, name: p.name, teamId: p.teamId }))}
            selectedTeamId={teamFilter}
            selectedPolicyId={policyId}
            showAllTeams={isAdmin}
          />
          <Link href="/reports/checklist" className="text-sm px-3 py-1.5 bg-white border border-indigo-200 text-indigo-700 rounded-lg hover:bg-indigo-50 font-medium whitespace-nowrap">
            Checklist →
          </Link>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard label="Tổng ca trực" value={totalShifts} sub={`${overrideCount} override`} color="blue"
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>}
        />
        <SummaryCard
          label="Xác nhận ca"
          value={confirmRate !== null ? `${confirmRate}%` : "—"}
          sub={`${confirmConfirmed}/${confirmTotal} ca`}
          color={confirmRate !== null && confirmRate >= 80 ? "green" : "yellow"}
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>}
        />
        <SummaryCard
          label="Checklist"
          value={checklistRate !== null ? `${checklistRate}%` : "—"}
          sub={`${checklistDone}/${checklistTotal} mục`}
          color={checklistRate !== null && checklistRate >= 80 ? "green" : checklistTotal === 0 ? "blue" : "orange"}
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg>}
        />
        <SummaryCard
          label="Ngày thiếu trực"
          value={coverageGaps.length}
          sub={`/${allWeekdays.length} ngày trong tuần`}
          color={coverageGaps.length === 0 ? "green" : "red"}
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>}
        />
      </div>

      {/* Coverage gaps detail */}
      {coverageGaps.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-3">
          <p className="text-sm font-semibold text-red-800 mb-2">Ngày thiếu ca trực ({coverageGaps.length})</p>
          <div className="flex flex-wrap gap-1.5">
            {coverageGaps.map((d) => (
              <span key={d.toISOString()} className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded font-medium">
                {format(d, "EEE dd/MM", { locale: vi })}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Shifts per person */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900 text-sm">Số ca theo người trực</h2>
            <span className="text-xs text-gray-400">{totalShifts} ca tổng</span>
          </div>
          {shiftsByPerson.length === 0 ? (
            <p className="px-5 py-8 text-center text-gray-400 text-sm">Không có dữ liệu.</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {shiftsByPerson.map((s) => {
                const user = usersMap[s.assigneeId];
                const pct = Math.round((s._count.id / maxShiftCount) * 100);
                const totalPct = totalShifts > 0 ? Math.round((s._count.id / totalShifts) * 100) : 0;
                const uc = confirmByUser[s.assigneeId] ?? {};
                const uConfirmed = uc["CONFIRMED"] ?? 0;
                const uTotal = Object.values(uc).reduce((a, b) => a + b, 0);
                const uRate = uTotal > 0 ? Math.round((uConfirmed / uTotal) * 100) : null;
                return (
                  <div key={s.assigneeId} className="px-5 py-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-gray-900">{user?.fullName ?? "—"}</span>
                      <div className="flex items-center gap-3">
                        {uRate !== null && (
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${uRate >= 80 ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
                            ✓{uRate}%
                          </span>
                        )}
                        <span className="text-xs text-gray-400">{totalPct}%</span>
                        <span className="text-sm font-bold text-gray-900 tabular-nums">{s._count.id} ca</span>
                      </div>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Shifts per policy */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900 text-sm">Số ca theo lịch trực</h2>
          </div>
          {shiftsByPolicy.length === 0 ? (
            <p className="px-5 py-8 text-center text-gray-400 text-sm">Không có dữ liệu.</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {shiftsByPolicy.map((s) => {
                const pol = policiesMap[s.policyId];
                const pct = totalShifts > 0 ? Math.round((s._count.id / totalShifts) * 100) : 0;
                return (
                  <div key={s.policyId} className="px-5 py-3">
                    <div className="flex items-center justify-between mb-1">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{pol?.name ?? "—"}</p>
                        {pol?.team && <p className="text-xs text-gray-400">{pol.team.name}</p>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-gray-400">{pct}%</span>
                        <span className="text-sm font-bold text-gray-900 tabular-nums">{s._count.id} ca</span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-teal-500 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Confirmation detail per person */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900 text-sm">Chi tiết xác nhận</h2>
            <span className="text-xs text-gray-400">{confirmTotal} ca</span>
          </div>
          {confirmTotal === 0 ? (
            <p className="px-5 py-8 text-center text-gray-400 text-sm">Không có dữ liệu.</p>
          ) : (
            <>
              <div className="px-5 py-3 grid grid-cols-4 gap-2 border-b border-gray-50 bg-gray-50/50">
                {[
                  { label: "Đã xác nhận", val: confirmConfirmed, cls: "text-green-700" },
                  { label: "Chờ", val: confirmPending, cls: "text-yellow-600" },
                  { label: "Từ chối", val: confirmDeclined, cls: "text-red-600" },
                  { label: "Hết hạn", val: confirmExpired, cls: "text-gray-400" },
                ].map(({ label, val, cls }) => (
                  <div key={label} className="text-center">
                    <p className={`text-lg font-bold tabular-nums ${cls}`}>{val}</p>
                    <p className="text-[10px] text-gray-400">{label}</p>
                  </div>
                ))}
              </div>
              <div className="divide-y divide-gray-50">
                {Object.entries(confirmByUser)
                  .sort((a, b) => (b[1]["CONFIRMED"] ?? 0) - (a[1]["CONFIRMED"] ?? 0))
                  .map(([uid, counts]) => {
                    const total = Object.values(counts).reduce((a, b) => a + b, 0);
                    const confirmed = counts["CONFIRMED"] ?? 0;
                    const declined = counts["DECLINED"] ?? 0;
                    const pending = counts["PENDING"] ?? 0;
                    const expired = counts["EXPIRED"] ?? 0;
                    const rate = total > 0 ? Math.round((confirmed / total) * 100) : 0;
                    return (
                      <div key={uid} className="px-5 py-2.5 flex items-center gap-3">
                        <span className="text-sm text-gray-900 font-medium flex-1 min-w-0 truncate">
                          {usersMap[uid]?.fullName ?? "—"}
                        </span>
                        <div className="flex items-center gap-1.5 text-xs shrink-0">
                          {confirmed > 0 && <span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium">✓{confirmed}</span>}
                          {pending > 0 && <span className="bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded font-medium">⏳{pending}</span>}
                          {declined > 0 && <span className="bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-medium">✗{declined}</span>}
                          {expired > 0 && <span className="bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded font-medium">⌛{expired}</span>}
                        </div>
                        <span className={`text-xs font-bold tabular-nums w-10 text-right ${rate >= 80 ? "text-green-600" : rate >= 50 ? "text-yellow-600" : "text-red-600"}`}>
                          {rate}%
                        </span>
                      </div>
                    );
                  })}
              </div>
            </>
          )}
        </div>

        {/* Alerts */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900 text-sm">Alerts</h2>
          </div>
          <div className="px-5 py-4 space-y-2.5">
            <StatRow label="Tổng alerts" value={alertTotal} />
            <StatRow label="Đang cháy" value={alertMap["FIRING"] ?? 0} valueClass="text-red-600 font-bold" dot="bg-red-500" />
            <StatRow label="Đã nhận xử lý" value={alertMap["ACKNOWLEDGED"] ?? 0} valueClass="text-yellow-600" dot="bg-yellow-500" />
            <StatRow label="Đã giải quyết" value={alertMap["RESOLVED"] ?? 0} valueClass="text-green-600" dot="bg-green-500" />
            <StatRow label="Tỷ lệ giải quyết" value={alertTotal > 0 ? `${Math.round(((alertMap["RESOLVED"] ?? 0) / alertTotal) * 100)}%` : "—"} />
            {avgAckMs !== null && <StatRow label="Avg response time" value={formatDuration(avgAckMs)} />}
          </div>
        </div>

        {/* Swaps */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900 text-sm">Đổi ca</h2>
          </div>
          <div className="px-5 py-4 space-y-2.5">
            <StatRow label="Tổng yêu cầu" value={swapTotal} />
            <StatRow label="Đang chờ" value={swapMap["REQUESTED"] ?? 0} valueClass="text-yellow-600" dot="bg-yellow-500" />
            <StatRow label="Chờ duyệt" value={swapMap["ACCEPTED_BY_TARGET"] ?? 0} valueClass="text-blue-600" dot="bg-blue-500" />
            <StatRow label="Đã duyệt" value={swapMap["APPROVED"] ?? 0} valueClass="text-green-600" dot="bg-green-500" />
            <StatRow label="Từ chối" value={swapMap["REJECTED"] ?? 0} valueClass="text-red-600" dot="bg-red-500" />
            <StatRow label="Đã hủy" value={swapMap["CANCELLED"] ?? 0} valueClass="text-gray-400" dot="bg-gray-300" />
          </div>
          {swapsByPerson.length > 0 && (
            <>
              <div className="px-5 pb-3 border-t border-gray-50 pt-3">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Người yêu cầu đổi nhiều nhất</p>
                {swapsByPerson.map((s) => (
                  <div key={s.requesterId} className="flex items-center justify-between py-1">
                    <span className="text-sm text-gray-700">{usersMap[s.requesterId]?.fullName ?? "—"}</span>
                    <span className="text-sm font-semibold text-gray-900 tabular-nums">{s._count.id} lần</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Checklist summary */}
        {checklistTotal > 0 && (
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900 text-sm">Checklist công việc</h2>
              <Link href={`/reports/checklist?from=${format(monthStart, "yyyy-MM-dd")}&to=${format(monthEnd, "yyyy-MM-dd")}${teamFilter ? `&teamId=${teamFilter}` : ""}`}
                className="text-xs text-indigo-600 hover:text-indigo-700 font-medium">
                Chi tiết →
              </Link>
            </div>
            <div className="px-5 py-4">
              <div className="flex items-end gap-3 mb-3">
                <p className="text-4xl font-bold text-gray-900">{checklistRate}%</p>
                <p className="text-sm text-gray-500 pb-1">{checklistDone}/{checklistTotal} mục hoàn thành</p>
              </div>
              <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${checklistRate! >= 80 ? "bg-green-500" : checklistRate! >= 50 ? "bg-yellow-500" : "bg-red-500"}`}
                  style={{ width: `${checklistRate}%` }}
                />
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

function SummaryCard({ label, value, sub, color, icon }: {
  label: string; value: number | string; sub: string; color: string; icon: React.ReactNode;
}) {
  const palette: Record<string, { border: string; bg: string; icon: string; value: string }> = {
    blue:   { border: "border-l-blue-500",   bg: "bg-blue-50",   icon: "text-blue-500",   value: "text-blue-700"   },
    green:  { border: "border-l-green-500",  bg: "bg-green-50",  icon: "text-green-500",  value: "text-green-700"  },
    yellow: { border: "border-l-yellow-500", bg: "bg-yellow-50", icon: "text-yellow-500", value: "text-yellow-700" },
    orange: { border: "border-l-orange-500", bg: "bg-orange-50", icon: "text-orange-500", value: "text-orange-700" },
    red:    { border: "border-l-red-500",    bg: "bg-red-50",    icon: "text-red-500",    value: "text-red-700"    },
  };
  const p = palette[color] ?? palette.blue;
  return (
    <div className={`bg-white rounded-xl border border-gray-200 border-l-4 ${p.border} p-5 flex items-start gap-3`}>
      <div className={`w-9 h-9 rounded-lg ${p.bg} flex items-center justify-center shrink-0 ${p.icon}`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500 leading-tight">{label}</p>
        <p className={`text-2xl font-bold mt-0.5 ${p.value}`}>{value}</p>
        <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
      </div>
    </div>
  );
}

function StatRow({ label, value, valueClass, dot }: { label: string; value: number | string; valueClass?: string; dot?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        {dot && <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />}
        <span className="text-sm text-gray-500">{label}</span>
      </div>
      <span className={`text-sm font-semibold tabular-nums ${valueClass ?? "text-gray-900"}`}>{value}</span>
    </div>
  );
}
