import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { startOfDay, endOfDay } from "date-fns";
import { ShiftStatus, ConfirmationStatus, SwapStatus, DeliveryStatus } from "@/app/generated/prisma/client";
import Link from "next/link";
import { format } from "date-fns";
import { vi } from "date-fns/locale";

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
  ] = await Promise.all([
    // My shifts today
    prisma.shift.count({
      where: {
        assigneeId: currentUser.id,
        startsAt: { lte: dayEnd },
        endsAt: { gte: dayStart },
        status: { in: [ShiftStatus.ACTIVE, ShiftStatus.PUBLISHED] },
      },
    }),
    // Pending confirmations for me
    prisma.shiftConfirmation.count({
      where: {
        userId: currentUser.id,
        status: ConfirmationStatus.PENDING,
        dueAt: { gte: today },
      },
    }),
    // Open swap requests involving me
    prisma.swapRequest.count({
      where: {
        OR: [{ requesterId: currentUser.id }, { targetUserId: currentUser.id }],
        status: { in: [SwapStatus.REQUESTED, SwapStatus.ACCEPTED_BY_TARGET] },
      },
    }),
    // Failed deliveries (admin only)
    currentUser.systemRole === "ADMIN"
      ? prisma.notificationDelivery.count({
          where: { status: DeliveryStatus.FAILED },
        })
      : Promise.resolve(0),
    // My upcoming shifts (next 7 days)
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
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500">Xin chào, {currentUser.fullName}</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Ca trực hôm nay"
          value={todayShifts}
          color="blue"
          href="/schedule"
        />
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

      {/* Upcoming shifts */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Ca trực sắp tới</h2>
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
  label,
  value,
  color,
  href,
}: {
  label: string;
  value: number;
  color: "blue" | "green" | "yellow" | "orange" | "red";
  href: string;
}) {
  const colors = {
    blue: "bg-blue-50 text-blue-700",
    green: "bg-green-50 text-green-700",
    yellow: "bg-yellow-50 text-yellow-700",
    orange: "bg-orange-50 text-orange-700",
    red: "bg-red-50 text-red-700",
  };
  return (
    <Link href={href} className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-sm transition-shadow">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${colors[color].split(" ")[1]}`}>{value}</p>
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
