import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { startOfDay, endOfDay, format } from "date-fns";
import { vi } from "date-fns/locale";
import { ShiftStatus, ConfirmationStatus, SwapStatus, DeliveryStatus } from "@/app/generated/prisma/client";
import Link from "next/link";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, fullName: true, systemRole: true },
  });
  if (!currentUser) redirect("/login");

  const today = new Date();
  const dayStart = startOfDay(today);
  const dayEnd = endOfDay(today);

  const [
    todayShifts,
    pendingConfirmations,
    openSwaps,
    failedDeliveries,
    upcomingShifts,
    activeOnCallShifts,
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
    // Who's on-call now: active shifts across all teams, no overrides
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
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 mt-0.5">Xin chào, {currentUser.fullName}</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Ca trực hôm nay" value={todayShifts} color="blue" href="/schedule" />
        <StatCard
          label="Chờ xác nhận"
          value={pendingConfirmations}
          color={pendingConfirmations > 0 ? "yellow" : "green"}
          href="/schedule"
        />
        <StatCard
          label="Yêu cầu đổi ca"
          value={openSwaps}
          color={openSwaps > 0 ? "orange" : "green"}
          href="/swaps"
        />
        {currentUser.systemRole === "ADMIN" && (
          <StatCard
            label="Thông báo lỗi"
            value={failedDeliveries}
            color={failedDeliveries > 0 ? "red" : "green"}
            href="/notifications"
          />
        )}
      </div>

      {/* Who's on-call right now */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse shrink-0" />
          <h2 className="font-semibold text-gray-900">Ai đang trực?</h2>
          <span className="text-xs text-gray-400 ml-1">
            {format(today, "HH:mm dd/MM/yyyy", { locale: vi })}
          </span>
        </div>
        {activeOnCallShifts.length === 0 ? (
          <p className="px-5 py-8 text-center text-gray-400 text-sm">
            Không có ca trực nào đang hoạt động.
          </p>
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
                        {shift.policy.team.name} · {shift.policy.name}
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
          <Link href="/schedule" className="text-sm text-blue-600 hover:text-blue-700">
            Xem tất cả →
          </Link>
        </div>
        <div className="divide-y divide-gray-50">
          {upcomingShifts.length === 0 ? (
            <p className="px-5 py-8 text-center text-gray-400 text-sm">
              Không có ca trực nào sắp tới.
            </p>
          ) : (
            upcomingShifts.map((shift) => (
              <div key={shift.id} className="px-5 py-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900 text-sm">{shift.policy.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {format(shift.startsAt, "EEEE dd/MM, HH:mm", { locale: vi })}
                    {" → "}
                    {format(shift.endsAt, "HH:mm dd/MM", { locale: vi })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <ConfirmBadge status={shift.confirmation?.status} />
                  {shift.confirmation?.status === "PENDING" && (
                    <Link
                      href={`/confirm/${shift.confirmation.token}`}
                      className="text-xs px-2 py-1 bg-blue-50 text-blue-700 rounded-lg font-medium hover:bg-blue-100"
                    >
                      Xác nhận
                    </Link>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label, value, color, href,
}: {
  label: string; value: number; color: "blue" | "green" | "yellow" | "orange" | "red"; href: string;
}) {
  const textColor = { blue: "text-blue-700", green: "text-green-700", yellow: "text-yellow-700", orange: "text-orange-700", red: "text-red-700" };
  return (
    <Link href={href} className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-sm transition-shadow">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${textColor[color]}`}>{value}</p>
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
