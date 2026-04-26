import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { startOfDay, endOfDay, format, formatDistanceToNow } from "date-fns";
import { vi } from "date-fns/locale";
import { ShiftStatus, ConfirmationStatus, SwapStatus, DeliveryStatus, AlertStatus } from "@/app/generated/prisma/client";
import Link from "next/link";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: {
      id: true,
      fullName: true,
      systemRole: true,
      teamMembers: { select: { teamId: true } },
    },
  });
  if (!currentUser) redirect("/login");

  const today = new Date();
  const dayStart = startOfDay(today);
  const dayEnd = endOfDay(today);

  const myTeamIds = currentUser.teamMembers.map((m) => m.teamId);

  const [
    todayShifts,
    pendingConfirmations,
    openSwaps,
    failedDeliveries,
    firingAlerts,
    upcomingShifts,
    activeOnCallShifts,
    recentFiringAlerts,
  ] = await Promise.all([
    prisma.shift.count({
      where: {
        assigneeId: currentUser.id,
        startsAt: { lte: dayEnd },
        endsAt: { gte: dayStart },
        status: { in: [ShiftStatus.ACTIVE, ShiftStatus.PUBLISHED] },
      },
    }),
    prisma.shiftConfirmation.count({
      where: {
        userId: currentUser.id,
        status: ConfirmationStatus.PENDING,
        dueAt: { gte: today },
      },
    }),
    prisma.swapRequest.count({
      where: {
        OR: [{ requesterId: currentUser.id }, { targetUserId: currentUser.id }],
        status: { in: [SwapStatus.REQUESTED, SwapStatus.ACCEPTED_BY_TARGET] },
      },
    }),
    currentUser.systemRole === "ADMIN"
      ? prisma.notificationDelivery.count({ where: { status: DeliveryStatus.FAILED } })
      : Promise.resolve(0),
    prisma.alert.count({
      where: {
        status: AlertStatus.FIRING,
        integration: currentUser.systemRole === "ADMIN" ? {} : { teamId: { in: myTeamIds } },
      },
    }),
    prisma.shift.findMany({
      where: {
        assigneeId: currentUser.id,
        startsAt: { gte: today },
        status: { in: [ShiftStatus.PUBLISHED, ShiftStatus.ACTIVE] },
      },
      include: {
        policy: { select: { name: true } },
        confirmation: { select: { status: true, token: true, dueAt: true } },
      },
      orderBy: { startsAt: "asc" },
      take: 5,
    }),
    prisma.shift.findMany({
      where: {
        startsAt: { lte: today },
        endsAt: { gte: today },
        status: { in: [ShiftStatus.PUBLISHED, ShiftStatus.ACTIVE] },
        overrideForShiftId: null,
      },
      include: {
        assignee: { select: { id: true, fullName: true, email: true } },
        backup: { select: { id: true, fullName: true } },
        policy: {
          select: {
            name: true,
            team: { select: { id: true, name: true } },
          },
        },
        overrides: {
          where: {
            startsAt: { lte: today },
            endsAt: { gte: today },
            status: { in: [ShiftStatus.PUBLISHED, ShiftStatus.ACTIVE] },
          },
          include: { assignee: { select: { id: true, fullName: true } } },
          take: 1,
        },
      },
      orderBy: { policy: { team: { name: "asc" } } },
    }),
    prisma.alert.findMany({
      where: {
        status: AlertStatus.FIRING,
        integration: currentUser.systemRole === "ADMIN" ? {} : { teamId: { in: myTeamIds } },
      },
      include: {
        integration: { select: { name: true, team: { select: { name: true } } } },
      },
      orderBy: { triggeredAt: "desc" },
      take: 5,
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 mt-0.5">Xin chào, {currentUser.fullName}</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Ca trực hôm nay"
          value={todayShifts}
          color="blue"
          href="/schedule"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          }
        />
        <StatCard
          label="Chờ xác nhận"
          value={pendingConfirmations}
          color={pendingConfirmations > 0 ? "yellow" : "green"}
          href="/schedule"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatCard
          label="Yêu cầu đổi ca"
          value={openSwaps}
          color={openSwaps > 0 ? "orange" : "green"}
          href="/swaps"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
          }
        />
        <StatCard
          label="Alerts đang cháy"
          value={firingAlerts}
          color={firingAlerts > 0 ? "red" : "green"}
          href="/alerts"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          }
        />
        {currentUser.systemRole === "ADMIN" && failedDeliveries > 0 && (
          <StatCard
            label="Thông báo lỗi"
            value={failedDeliveries}
            color="red"
            href="/notifications"
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            }
          />
        )}
      </div>

      {/* Firing alerts — alarming section */}
      {recentFiringAlerts.length > 0 && (
        <div className="rounded-xl border border-red-300 bg-red-50 overflow-hidden">
          <div className="px-5 py-3.5 bg-red-100 border-b border-red-200 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-3 w-3 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
              </span>
              <h2 className="font-semibold text-red-900">Alerts đang cháy</h2>
              <span className="text-xs bg-red-500 text-white px-2 py-0.5 rounded-full font-bold">
                {firingAlerts}
              </span>
            </div>
            <Link href="/alerts?status=FIRING" className="text-sm text-red-700 hover:text-red-900 font-medium">
              Xem tất cả →
            </Link>
          </div>
          <div className="divide-y divide-red-100">
            {recentFiringAlerts.map((alert) => (
              <div key={alert.id} className="px-5 py-3.5 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-red-900 truncate">{alert.title}</p>
                  <p className="text-xs text-red-600 mt-0.5">
                    {alert.integration.team?.name ?? "—"} · {alert.integration.name} ·{" "}
                    {formatDistanceToNow(alert.triggeredAt, { addSuffix: true, locale: vi })}
                  </p>
                </div>
                {alert.severity && (
                  <span className="text-xs font-bold uppercase bg-red-200 text-red-800 px-2 py-0.5 rounded shrink-0">
                    {alert.severity}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Who's on-call right now */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
          </span>
          <h2 className="font-semibold text-gray-900">Ai đang trực?</h2>
          <span className="text-xs text-gray-400 ml-1">
            {format(today, "HH:mm dd/MM/yyyy", { locale: vi })}
          </span>
        </div>
        {activeOnCallShifts.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-2">
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-gray-400 text-sm">Không có ca trực nào đang hoạt động.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {activeOnCallShifts.map((shift) => {
              const effectiveAssignee = shift.overrides[0]?.assignee ?? shift.assignee;
              const isOverridden = shift.overrides.length > 0;
              return (
                <div key={shift.id} className="px-5 py-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center text-sm font-semibold text-indigo-700 shrink-0">
                      {effectiveAssignee.fullName.split(" ").map((w) => w[0]).slice(-2).join("").toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-gray-900">{effectiveAssignee.fullName}</p>
                        {isOverridden && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">Override</span>
                        )}
                        {effectiveAssignee.id === currentUser.id && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-medium">Bạn</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400">
                        {shift.policy?.team?.name ?? "—"} · {shift.policy?.name ?? "—"}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500">
                      đến {format(shift.endsAt, "HH:mm dd/MM", { locale: vi })}
                    </p>
                    {shift.backup && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        Backup: {shift.backup.fullName}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Upcoming shifts */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Ca trực sắp tới của tôi</h2>
          <Link href="/schedule" className="text-sm text-indigo-600 hover:text-indigo-700 font-medium">
            Xem tất cả →
          </Link>
        </div>
        {upcomingShifts.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-2">
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="text-gray-400 text-sm">Không có ca trực nào sắp tới.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {upcomingShifts.map((shift, idx) => (
              <div key={shift.id} className="px-5 py-4 flex items-center gap-4">
                <div className="flex flex-col items-center shrink-0 w-10">
                  <div className={`w-3 h-3 rounded-full border-2 ${idx === 0 ? "bg-indigo-500 border-indigo-500" : "bg-white border-gray-300"}`} />
                  {idx < upcomingShifts.length - 1 && (
                    <div className="w-0.5 flex-1 bg-gray-100 mt-1 h-full min-h-[1.5rem]" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 text-sm">{shift.policy?.name ?? "—"}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {format(shift.startsAt, "EEEE dd/MM, HH:mm", { locale: vi })}
                    {" → "}
                    {format(shift.endsAt, "HH:mm dd/MM", { locale: vi })}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {formatDistanceToNow(shift.startsAt, { addSuffix: true, locale: vi })}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <ConfirmBadge status={shift.confirmation?.status} />
                  {shift.confirmation?.status === "PENDING" && (
                    <Link
                      href={`/confirm/${shift.confirmation.token}`}
                      className="text-xs px-2.5 py-1 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700"
                    >
                      Xác nhận
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label, value, color, href, icon,
}: {
  label: string; value: number; color: "blue" | "green" | "yellow" | "orange" | "red"; href: string; icon: React.ReactNode;
}) {
  const palette = {
    blue:   { border: "border-l-blue-500",   bg: "bg-blue-50",   icon: "text-blue-500",   value: "text-blue-700"   },
    green:  { border: "border-l-green-500",  bg: "bg-green-50",  icon: "text-green-500",  value: "text-green-700"  },
    yellow: { border: "border-l-yellow-500", bg: "bg-yellow-50", icon: "text-yellow-500", value: "text-yellow-700" },
    orange: { border: "border-l-orange-500", bg: "bg-orange-50", icon: "text-orange-500", value: "text-orange-700" },
    red:    { border: "border-l-red-500",    bg: "bg-red-50",    icon: "text-red-500",    value: "text-red-700"    },
  };
  const p = palette[color];
  return (
    <Link
      href={href}
      className={`bg-white rounded-xl border border-gray-200 border-l-4 ${p.border} p-5 hover:shadow-md transition-shadow flex items-start gap-3`}
    >
      <div className={`w-9 h-9 rounded-lg ${p.bg} flex items-center justify-center shrink-0 ${p.icon}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500 leading-tight">{label}</p>
        <p className={`text-2xl font-bold mt-0.5 ${p.value}`}>{value}</p>
      </div>
    </Link>
  );
}

function ConfirmBadge({ status }: { status?: string | null }) {
  const map: Record<string, string> = {
    PENDING: "bg-yellow-100 text-yellow-700",
    CONFIRMED: "bg-green-100 text-green-700",
    DECLINED: "bg-red-100 text-red-700",
    EXPIRED: "bg-gray-100 text-gray-400",
  };
  const label: Record<string, string> = {
    PENDING: "Chờ xác nhận",
    CONFIRMED: "Đã xác nhận",
    DECLINED: "Từ chối",
    EXPIRED: "Hết hạn",
  };
  if (!status) return null;
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${map[status] ?? ""}`}>
      {label[status] ?? status}
    </span>
  );
}
