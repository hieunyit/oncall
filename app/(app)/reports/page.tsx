import type React from "react";
import Link from "next/link";
import {
  eachDayOfInterval,
  endOfMonth,
  format,
  getDay,
  startOfMonth,
  subMonths,
} from "date-fns";
import { vi } from "date-fns/locale";
import { redirect } from "next/navigation";
import { AlertStatus, ShiftSource } from "@/app/generated/prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ReportsFilters } from "./reports-filters";

export const metadata = { title: "Báo cáo" };

interface PageProps {
  searchParams: Promise<{ month?: string; teamId?: string; policyId?: string }>;
}

function parseMonth(value?: string) {
  if (!value) return new Date();
  const parsed = new Date(`${value}-01T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
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

  const { month, teamId, policyId } = await searchParams;
  const isAdmin = currentUser.systemRole === "ADMIN";
  const myTeamIds = currentUser.teamMembers.map((member) => member.teamId);

  const selectedDate = parseMonth(month);
  const monthStart = startOfMonth(selectedDate);
  const monthEnd = endOfMonth(selectedDate);
  const selectedMonth = format(selectedDate, "yyyy-MM");

  const monthOptions = Array.from({ length: 12 }, (_, index) => {
    const date = subMonths(new Date(), index);
    return {
      value: format(date, "yyyy-MM"),
      label: format(date, "MMMM yyyy", { locale: vi }),
    };
  });

  const [teams, policies] = await Promise.all([
    prisma.team.findMany({
      where: isAdmin ? {} : { id: { in: myTeamIds } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.rotationPolicy.findMany({
      where: isAdmin
        ? { isActive: true }
        : { teamId: { in: myTeamIds }, isActive: true },
      select: { id: true, name: true, teamId: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const teamFilter =
    teamId || (!isAdmin && myTeamIds.length === 1 ? myTeamIds[0] : undefined);

  const shiftWhere = {
    startsAt: { gte: monthStart, lte: monthEnd },
    overrideForShiftId: null,
    ...(policyId
      ? { policyId }
      : teamFilter
        ? { policy: { teamId: teamFilter } }
        : isAdmin
          ? {}
          : { policy: { teamId: { in: myTeamIds } } }),
  };

  const alertTeamWhere = teamFilter
    ? { integration: { teamId: teamFilter } }
    : isAdmin
      ? {}
      : { integration: { teamId: { in: myTeamIds } } };

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
    prisma.shift.groupBy({
      by: ["assigneeId"],
      where: shiftWhere,
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    }),
    prisma.shift.groupBy({
      by: ["policyId"],
      where: shiftWhere,
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    }),
    prisma.shiftConfirmation.findMany({
      where: { shift: shiftWhere },
      select: { userId: true, status: true },
    }),
    prisma.shiftTask.count({ where: { shift: shiftWhere } }),
    prisma.shiftTask.count({ where: { isCompleted: true, shift: shiftWhere } }),
    prisma.shift.count({
      where: {
        source: ShiftSource.OVERRIDE,
        startsAt: { gte: monthStart, lte: monthEnd },
        ...(policyId
          ? { policyId }
          : teamFilter
            ? { policy: { teamId: teamFilter } }
            : isAdmin
              ? {}
              : { policy: { teamId: { in: myTeamIds } } }),
      },
    }),
    prisma.swapRequest.groupBy({
      by: ["status"],
      where: {
        createdAt: { gte: monthStart, lte: monthEnd },
        ...(teamFilter
          ? { originalShift: { policy: { teamId: teamFilter } } }
          : isAdmin
            ? {}
            : { originalShift: { policy: { teamId: { in: myTeamIds } } } }),
      },
      _count: { id: true },
    }),
    prisma.swapRequest.groupBy({
      by: ["requesterId"],
      where: {
        createdAt: { gte: monthStart, lte: monthEnd },
        ...(teamFilter
          ? { originalShift: { policy: { teamId: teamFilter } } }
          : isAdmin
            ? {}
            : { originalShift: { policy: { teamId: { in: myTeamIds } } } }),
      },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 5,
    }),
    prisma.alert.groupBy({
      by: ["status"],
      where: {
        triggeredAt: { gte: monthStart, lte: monthEnd },
        ...alertTeamWhere,
      },
      _count: { id: true },
    }),
    prisma.alert.findMany({
      where: {
        status: { in: [AlertStatus.ACKNOWLEDGED, AlertStatus.RESOLVED] },
        acknowledgedAt: { not: null },
        triggeredAt: { gte: monthStart, lte: monthEnd },
        ...alertTeamWhere,
      },
      select: { triggeredAt: true, acknowledgedAt: true },
    }),
    prisma.shift.findMany({
      where: { ...shiftWhere },
      select: { startsAt: true },
    }),
  ]);

  const userIds = [
    ...new Set([
      ...shiftsByPerson.map((record) => record.assigneeId),
      ...confirmationsByPerson.map((record) => record.userId),
      ...swapsByPerson.map((record) => record.requesterId),
    ]),
  ];

  const usersMap: Record<string, { fullName: string }> =
    userIds.length > 0
      ? Object.fromEntries(
          (
            await prisma.user.findMany({
              where: { id: { in: userIds } },
              select: { id: true, fullName: true },
            })
          ).map((user) => [user.id, user])
        )
      : {};

  const policyIds = shiftsByPolicy.map((record) => record.policyId);
  const policiesMap: Record<
    string,
    { name: string; teamId: string; team?: { name: string } }
  > =
    policyIds.length > 0
      ? Object.fromEntries(
          (
            await prisma.rotationPolicy.findMany({
              where: { id: { in: policyIds } },
              select: {
                id: true,
                name: true,
                teamId: true,
                team: { select: { name: true } },
              },
            })
          ).map((policy) => [policy.id, policy])
        )
      : {};

  const totalShifts = shiftsByPerson.reduce((sum, record) => sum + record._count.id, 0);
  const maxShiftCount = shiftsByPerson[0]?._count.id ?? 0;
  const minShiftCount =
    shiftsByPerson.length > 0
      ? shiftsByPerson[shiftsByPerson.length - 1]._count.id
      : 0;
  const balanceGap = Math.max(0, maxShiftCount - minShiftCount);

  const confirmByUser: Record<string, Record<string, number>> = {};
  for (const confirmation of confirmationsByPerson) {
    if (!confirmByUser[confirmation.userId]) confirmByUser[confirmation.userId] = {};
    confirmByUser[confirmation.userId][confirmation.status] =
      (confirmByUser[confirmation.userId][confirmation.status] ?? 0) + 1;
  }

  const confirmTotal = confirmationsByPerson.length;
  const confirmConfirmed = confirmationsByPerson.filter(
    (record) => record.status === "CONFIRMED"
  ).length;
  const confirmPending = confirmationsByPerson.filter(
    (record) => record.status === "PENDING"
  ).length;
  const confirmDeclined = confirmationsByPerson.filter(
    (record) => record.status === "DECLINED"
  ).length;
  const confirmExpired = confirmationsByPerson.filter(
    (record) => record.status === "EXPIRED"
  ).length;

  const confirmRate =
    confirmTotal > 0 ? Math.round((confirmConfirmed / confirmTotal) * 100) : null;
  const checklistRate =
    checklistTotal > 0 ? Math.round((checklistDone / checklistTotal) * 100) : null;

  const swapMap = Object.fromEntries(swapStats.map((row) => [row.status, row._count.id]));
  const swapTotal = swapStats.reduce((sum, row) => sum + row._count.id, 0);

  const alertMap = Object.fromEntries(alertStats.map((row) => [row.status, row._count.id]));
  const alertTotal = alertStats.reduce((sum, row) => sum + row._count.id, 0);
  const resolvedAlertCount = alertMap.RESOLVED ?? 0;
  const alertResolvedRate =
    alertTotal > 0 ? Math.round((resolvedAlertCount / alertTotal) * 100) : 100;

  const averageAcknowledgeMs =
    ackedAlerts.length > 0
      ? ackedAlerts.reduce(
          (sum, row) =>
            sum + (row.acknowledgedAt!.getTime() - row.triggeredAt.getTime()),
          0
        ) / ackedAlerts.length
      : null;

  const toVNDay = (value: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(value);

  const coveredDays = new Set(allShiftsForCoverage.map((shift) => toVNDay(shift.startsAt)));
  const allWeekdays = eachDayOfInterval({ start: monthStart, end: monthEnd }).filter(
    (date) => {
      const day = getDay(date);
      return day !== 0 && day !== 6;
    }
  );
  const coverageGaps = allWeekdays.filter(
    (date) => !coveredDays.has(format(date, "yyyy-MM-dd"))
  );
  const coverageRate =
    allWeekdays.length > 0
      ? Math.round(((allWeekdays.length - coverageGaps.length) / allWeekdays.length) * 100)
      : 100;

  const healthMetrics = [
    confirmRate ?? 70,
    checklistRate ?? 70,
    coverageRate,
    alertResolvedRate,
  ];
  const healthScore = Math.round(
    healthMetrics.reduce((sum, value) => sum + value, 0) / healthMetrics.length
  );

  const selectedTeamName = teams.find((team) => team.id === teamFilter)?.name;
  const selectedPolicyName = policies.find((policy) => policy.id === policyId)?.name;
  const monthLabel = format(monthStart, "MMMM yyyy", { locale: vi });

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-700 bg-gradient-to-r from-slate-900 via-slate-900 to-cyan-900 px-6 py-5 text-white shadow-sm">
        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-300">
          Operations Analytics
        </p>
        <h1 className="mt-1 text-2xl font-semibold">Báo cáo vận hành trực</h1>
        <p className="mt-1 text-sm text-slate-300">
          Tổng hợp chất lượng lịch trực, xác nhận ca, checklist và xử lý cảnh báo.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <HeaderChip label={`Tháng ${monthLabel}`} />
          <HeaderChip label={selectedTeamName ? `Nhóm: ${selectedTeamName}` : "Phạm vi: toàn nhóm"} />
          {selectedPolicyName && <HeaderChip label={`Chính sách: ${selectedPolicyName}`} />}
          <HeaderChip label={`Sức khỏe vận hành: ${healthScore}%`} />
        </div>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
          <ReportsFilters
            monthOptions={monthOptions}
            selectedMonth={selectedMonth}
            teams={teams}
            policies={policies.map((policy) => ({
              id: policy.id,
              name: policy.name,
              teamId: policy.teamId,
            }))}
            selectedTeamId={teamFilter}
            selectedPolicyId={policyId}
            showAllTeams={isAdmin}
          />

          <Link
            href="/reports/checklist"
            className="inline-flex h-10 items-center rounded-xl border border-slate-500 bg-slate-800/80 px-4 text-sm font-semibold text-white hover:bg-slate-700"
          >
            Chi tiết checklist
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-6">
        <SummaryCard
          label="Tổng ca trực"
          value={totalShifts}
          helper={`${overrideCount} ca override`}
          tone="indigo"
        />
        <SummaryCard
          label="Tỷ lệ xác nhận"
          value={confirmRate === null ? "-" : `${confirmRate}%`}
          helper={`${confirmConfirmed}/${confirmTotal} ca`}
          tone={confirmRate !== null && confirmRate >= 80 ? "green" : "amber"}
        />
        <SummaryCard
          label="Checklist hoàn thành"
          value={checklistRate === null ? "-" : `${checklistRate}%`}
          helper={`${checklistDone}/${checklistTotal} mục`}
          tone={
            checklistRate === null
              ? "slate"
              : checklistRate >= 80
                ? "green"
                : checklistRate >= 50
                  ? "amber"
                  : "rose"
          }
        />
        <SummaryCard
          label="Độ phủ ngày trực"
          value={`${coverageRate}%`}
          helper={`${coverageGaps.length} ngày thiếu trực`}
          tone={coverageGaps.length === 0 ? "green" : "rose"}
        />
        <SummaryCard
          label="MTTR xác nhận alert"
          value={averageAcknowledgeMs ? formatDuration(averageAcknowledgeMs) : "-"}
          helper={`${alertTotal} alert trong tháng`}
          tone="cyan"
        />
        <SummaryCard
          label="Độ lệch phân bổ ca"
          value={balanceGap}
          helper={`max ${maxShiftCount} · min ${minShiftCount}`}
          tone={balanceGap <= 1 ? "green" : balanceGap <= 2 ? "amber" : "rose"}
        />
      </div>

      {coverageGaps.length > 0 && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4">
          <p className="text-sm font-semibold text-rose-800">
            Ngày thiếu trực ({coverageGaps.length})
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {coverageGaps.map((date) => (
              <span
                key={date.toISOString()}
                className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-700"
              >
                {format(date, "EEE dd/MM", { locale: vi })}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel title="Phân bổ ca theo người" subtitle={`${shiftsByPerson.length} thành viên`}>
          {shiftsByPerson.length === 0 ? (
            <EmptyPanel />
          ) : (
            <div className="space-y-3">
              {shiftsByPerson.map((record) => {
                const user = usersMap[record.assigneeId];
                const count = record._count.id;
                const pctTop = maxShiftCount > 0 ? Math.round((count / maxShiftCount) * 100) : 0;
                const pctAll = totalShifts > 0 ? Math.round((count / totalShifts) * 100) : 0;
                const userConfirm = confirmByUser[record.assigneeId] ?? {};
                const userConfirmed = userConfirm.CONFIRMED ?? 0;
                const userTotal = Object.values(userConfirm).reduce(
                  (sum, value) => sum + value,
                  0
                );
                const userRate =
                  userTotal > 0 ? Math.round((userConfirmed / userTotal) * 100) : null;

                return (
                  <div key={record.assigneeId} className="rounded-xl border border-gray-100 p-3">
                    <div className="mb-1 flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-semibold text-gray-900">
                        {user?.fullName ?? "Không xác định"}
                      </span>
                      <div className="flex items-center gap-2 text-xs">
                        {userRate !== null && (
                          <span
                            className={`rounded-full px-2 py-0.5 font-semibold ${
                              userRate >= 80
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            xác nhận {userRate}%
                          </span>
                        )}
                        <span className="text-gray-500">{pctAll}%</span>
                        <span className="text-sm font-bold tabular-nums text-gray-900">
                          {count} ca
                        </span>
                      </div>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full bg-indigo-500"
                        style={{ width: `${pctTop}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel title="Phân bổ theo chính sách" subtitle={`${shiftsByPolicy.length} chính sách`}>
          {shiftsByPolicy.length === 0 ? (
            <EmptyPanel />
          ) : (
            <div className="space-y-3">
              {shiftsByPolicy.map((record) => {
                const policy = policiesMap[record.policyId];
                const count = record._count.id;
                const pct = totalShifts > 0 ? Math.round((count / totalShifts) * 100) : 0;
                return (
                  <div key={record.policyId} className="rounded-xl border border-gray-100 p-3">
                    <div className="mb-1 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-gray-900">
                          {policy?.name ?? "Không xác định"}
                        </p>
                        <p className="truncate text-xs text-gray-500">{policy?.team?.name ?? "-"}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold tabular-nums text-gray-900">{count} ca</p>
                        <p className="text-xs text-gray-500">{pct}%</p>
                      </div>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                      <div className="h-full rounded-full bg-cyan-500" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel
          title="Trạng thái xác nhận ca"
          subtitle={`${confirmTotal} phản hồi`}
          extra={
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
              {confirmRate ?? 0}%
            </span>
          }
        >
          {confirmTotal === 0 ? (
            <EmptyPanel />
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-2">
                <MiniStat label="Đã xác nhận" value={confirmConfirmed} tone="green" />
                <MiniStat label="Đang chờ" value={confirmPending} tone="amber" />
                <MiniStat label="Từ chối" value={confirmDeclined} tone="rose" />
                <MiniStat label="Hết hạn" value={confirmExpired} tone="slate" />
              </div>

              <div className="space-y-2">
                {Object.entries(confirmByUser)
                  .sort((a, b) => (b[1].CONFIRMED ?? 0) - (a[1].CONFIRMED ?? 0))
                  .map(([userId, counts]) => {
                    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
                    const confirmed = counts.CONFIRMED ?? 0;
                    const pending = counts.PENDING ?? 0;
                    const declined = counts.DECLINED ?? 0;
                    const expired = counts.EXPIRED ?? 0;
                    const rate = total > 0 ? Math.round((confirmed / total) * 100) : 0;

                    return (
                      <div
                        key={userId}
                        className="flex items-center gap-2 rounded-xl border border-gray-100 px-3 py-2"
                      >
                        <span className="flex-1 truncate text-sm font-medium text-gray-800">
                          {usersMap[userId]?.fullName ?? "Không xác định"}
                        </span>
                        <div className="flex items-center gap-1.5 text-[11px]">
                          {confirmed > 0 && <Badge label={`✓${confirmed}`} tone="green" />}
                          {pending > 0 && <Badge label={`⏳${pending}`} tone="amber" />}
                          {declined > 0 && <Badge label={`✕${declined}`} tone="rose" />}
                          {expired > 0 && <Badge label={`⌛${expired}`} tone="slate" />}
                        </div>
                        <span
                          className={`w-12 text-right text-xs font-bold tabular-nums ${
                            rate >= 80
                              ? "text-emerald-700"
                              : rate >= 50
                                ? "text-amber-700"
                                : "text-rose-700"
                          }`}
                        >
                          {rate}%
                        </span>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Alerts" subtitle={`${alertTotal} sự kiện`}>
          <div className="space-y-2">
            <StatRow label="Đang firing" value={alertMap.FIRING ?? 0} dot="bg-rose-500" />
            <StatRow label="Đã acknowledged" value={alertMap.ACKNOWLEDGED ?? 0} dot="bg-amber-500" />
            <StatRow label="Đã resolved" value={alertMap.RESOLVED ?? 0} dot="bg-emerald-500" />
            <StatRow label="Tỷ lệ resolved" value={`${alertResolvedRate}%`} />
            <StatRow
              label="MTTR (ack)"
              value={averageAcknowledgeMs ? formatDuration(averageAcknowledgeMs) : "-"}
            />
          </div>
        </Panel>

        <Panel title="Đổi ca" subtitle={`${swapTotal} yêu cầu`}>
          <div className="space-y-2">
            <StatRow label="Đang chờ" value={swapMap.REQUESTED ?? 0} dot="bg-amber-500" />
            <StatRow label="Chờ duyệt" value={swapMap.ACCEPTED_BY_TARGET ?? 0} dot="bg-blue-500" />
            <StatRow label="Đã duyệt" value={swapMap.APPROVED ?? 0} dot="bg-emerald-500" />
            <StatRow label="Từ chối" value={swapMap.REJECTED ?? 0} dot="bg-rose-500" />
            <StatRow label="Đã hủy" value={swapMap.CANCELLED ?? 0} dot="bg-slate-400" />
          </div>

          {swapsByPerson.length > 0 && (
            <div className="mt-4 border-t border-gray-100 pt-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Người tạo yêu cầu nhiều nhất
              </p>
              <div className="space-y-1.5">
                {swapsByPerson.map((record) => (
                  <div key={record.requesterId} className="flex items-center justify-between text-sm">
                    <span className="truncate text-gray-700">
                      {usersMap[record.requesterId]?.fullName ?? "Không xác định"}
                    </span>
                    <span className="font-semibold tabular-nums text-gray-900">
                      {record._count.id}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>

        {checklistTotal > 0 && (
          <Panel
            title="Checklist công việc"
            subtitle={`${checklistDone}/${checklistTotal} mục hoàn thành`}
            extra={
              <Link
                href={`/reports/checklist?from=${format(monthStart, "yyyy-MM-dd")}&to=${format(monthEnd, "yyyy-MM-dd")}${teamFilter ? `&teamId=${teamFilter}` : ""}`}
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
              >
                Xem chi tiết
              </Link>
            }
          >
            <div className="space-y-3">
              <div className="flex items-end gap-2">
                <p className="text-4xl font-bold text-gray-900">
                  {checklistRate === null ? "-" : `${checklistRate}%`}
                </p>
                <p className="pb-1 text-sm text-gray-500">hoàn thành</p>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-gray-100">
                <div
                  className={`h-full rounded-full ${
                    checklistRate !== null && checklistRate >= 80
                      ? "bg-emerald-500"
                      : checklistRate !== null && checklistRate >= 50
                        ? "bg-amber-500"
                        : "bg-rose-500"
                  }`}
                  style={{ width: `${checklistRate ?? 0}%` }}
                />
              </div>
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}

function formatDuration(milliseconds: number) {
  const minutes = Math.round(milliseconds / 60000);
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  const remain = minutes % 60;
  return remain > 0 ? `${hours}g${remain}p` : `${hours}h`;
}

function HeaderChip({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-slate-600 bg-slate-800/70 px-2.5 py-1">
      {label}
    </span>
  );
}

function SummaryCard({
  label,
  value,
  helper,
  tone,
}: {
  label: string;
  value: string | number;
  helper: string;
  tone: "indigo" | "green" | "amber" | "rose" | "cyan" | "slate";
}) {
  const toneClass: Record<typeof tone, string> = {
    indigo: "bg-indigo-100 text-indigo-700",
    green: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-700",
    rose: "bg-rose-100 text-rose-700",
    cyan: "bg-cyan-100 text-cyan-700",
    slate: "bg-slate-100 text-slate-700",
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

function Panel({
  title,
  subtitle,
  extra,
  children,
}: {
  title: string;
  subtitle?: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
        </div>
        {extra}
      </div>
      {children}
    </section>
  );
}

function EmptyPanel() {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-500">
      Không có dữ liệu trong phạm vi đã chọn.
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "green" | "amber" | "rose" | "slate";
}) {
  const toneClass: Record<typeof tone, string> = {
    green: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-700",
    rose: "bg-rose-100 text-rose-700",
    slate: "bg-slate-100 text-slate-700",
  };
  return (
    <div className={`rounded-xl px-2 py-2 text-center ${toneClass[tone]}`}>
      <p className="text-base font-bold tabular-nums">{value}</p>
      <p className="text-[10px]">{label}</p>
    </div>
  );
}

function Badge({ label, tone }: { label: string; tone: "green" | "amber" | "rose" | "slate" }) {
  const toneClass: Record<typeof tone, string> = {
    green: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-700",
    rose: "bg-rose-100 text-rose-700",
    slate: "bg-slate-100 text-slate-700",
  };
  return <span className={`rounded-full px-2 py-0.5 font-semibold ${toneClass[tone]}`}>{label}</span>;
}

function StatRow({
  label,
  value,
  dot,
}: {
  label: string;
  value: number | string;
  dot?: string;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <div className="flex items-center gap-2 text-gray-600">
        {dot && <span className={`h-2 w-2 rounded-full ${dot}`} />}
        <span>{label}</span>
      </div>
      <span className="font-semibold tabular-nums text-gray-900">{value}</span>
    </div>
  );
}
