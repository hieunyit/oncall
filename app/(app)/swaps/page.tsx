import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { ShiftStatus, SwapStatus } from "@/app/generated/prisma/client";
import { SwapCard } from "./swap-card";
import { CreateSwapButton } from "./create-swap-button";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  REQUESTED: { label: "Đã gửi yêu cầu", color: "bg-yellow-100 text-yellow-700" },
  ACCEPTED_BY_TARGET: { label: "Bên kia chấp nhận", color: "bg-blue-100 text-blue-700" },
  APPROVED: { label: "Đã phê duyệt", color: "bg-green-100 text-green-700" },
  REJECTED: { label: "Bị từ chối", color: "bg-red-100 text-red-700" },
  CANCELLED: { label: "Đã hủy", color: "bg-gray-100 text-gray-500" },
  EXPIRED: { label: "Hết hạn", color: "bg-gray-100 text-gray-400" },
};

export default async function SwapsPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  });
  if (!currentUser) redirect("/login");

  const [swaps, myUpcomingShifts] = await Promise.all([
    prisma.swapRequest.findMany({
      where: {
        OR: [{ requesterId: currentUser.id }, { targetUserId: currentUser.id }],
      },
      include: {
        requester: { select: { id: true, fullName: true } },
        targetUser: { select: { id: true, fullName: true } },
        originalShift: {
          include: { policy: { select: { name: true } } },
        },
        targetShift: {
          include: { policy: { select: { name: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    // My upcoming shifts to select for swap
    prisma.shift.findMany({
      where: {
        assigneeId: currentUser.id,
        startsAt: { gte: new Date() },
        status: { in: [ShiftStatus.PUBLISHED, ShiftStatus.ACTIVE] },
      },
      include: { policy: { select: { name: true } } },
      orderBy: { startsAt: "asc" },
      take: 20,
    }),
  ]);

  // Group by status
  const activeStatuses: string[] = [SwapStatus.REQUESTED, SwapStatus.ACCEPTED_BY_TARGET];
  const activeSwaps = swaps.filter((s) => activeStatuses.includes(s.status));
  const historySwaps = swaps.filter(
    (s) => !activeSwaps.includes(s)
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Yêu cầu đổi ca</h1>
        <CreateSwapButton
          myShifts={myUpcomingShifts.map((s) => ({
            id: s.id,
            label: `${s.policy.name} — ${format(s.startsAt, "dd/MM HH:mm", { locale: vi })}`,
          }))}
        />
      </div>

      {/* Active swaps */}
      {activeSwaps.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide">Đang chờ xử lý</h2>
          {activeSwaps.map((swap) => (
            <SwapCard
              key={swap.id}
              swap={swap}
              currentUserId={currentUser.id}
              statusLabels={STATUS_LABELS}
            />
          ))}
        </section>
      )}

      {/* History */}
      {historySwaps.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide">Lịch sử</h2>
          {historySwaps.map((swap) => (
            <SwapCard
              key={swap.id}
              swap={swap}
              currentUserId={currentUser.id}
              statusLabels={STATUS_LABELS}
            />
          ))}
        </section>
      )}

      {swaps.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          Chưa có yêu cầu đổi ca nào.
        </div>
      )}
    </div>
  );
}
