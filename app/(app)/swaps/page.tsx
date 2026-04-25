import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { ShiftStatus, SwapStatus } from "@/app/generated/prisma/client";
import { SwapCard } from "./swap-card";
import { CreateSwapButton } from "./create-swap-button";

export const metadata = { title: "Đổi ca" };

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  REQUESTED: { label: "Đã gửi yêu cầu", color: "bg-yellow-100 text-yellow-700" },
  ACCEPTED_BY_TARGET: { label: "Chờ quản lý duyệt", color: "bg-blue-100 text-blue-700" },
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
    select: {
      id: true,
      systemRole: true,
      teamMembers: { where: { role: "MANAGER" }, select: { teamId: true } },
    },
  });
  if (!currentUser) redirect("/login");

  const isAdmin = currentUser.systemRole === "ADMIN";
  const managedTeamIds = currentUser.teamMembers.map((m) => m.teamId);
  const isManager = managedTeamIds.length > 0;

  const swapInclude = {
    requester: { select: { id: true, fullName: true } },
    targetUser: { select: { id: true, fullName: true } },
    originalShift: {
      include: { policy: { select: { name: true, teamId: true } } },
    },
    targetShift: {
      include: { policy: { select: { name: true } } },
    },
  } as const;

  // Own swaps + swaps pending manager approval for managed teams
  const [mySwaps, pendingApproval, myUpcomingShifts] = await Promise.all([
    prisma.swapRequest.findMany({
      where: {
        OR: [{ requesterId: currentUser.id }, { targetUserId: currentUser.id }],
      },
      include: swapInclude,
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    // Swaps waiting for manager to approve (not already in my own swaps)
    (isAdmin || isManager)
      ? prisma.swapRequest.findMany({
          where: {
            status: SwapStatus.ACCEPTED_BY_TARGET,
            requesterId: { not: currentUser.id },
            targetUserId: { not: currentUser.id },
            ...(isAdmin ? {} : {
              originalShift: { policy: { teamId: { in: managedTeamIds } } },
            }),
          },
          include: swapInclude,
          orderBy: { createdAt: "desc" },
          take: 50,
        })
      : Promise.resolve([]),
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

  const activeStatuses: string[] = [SwapStatus.REQUESTED, SwapStatus.ACCEPTED_BY_TARGET];
  const activeSwaps = mySwaps.filter((s) => activeStatuses.includes(s.status));
  const historySwaps = mySwaps.filter((s) => !activeStatuses.includes(s.status));

  const canApproveSet = new Set(
    [...managedTeamIds, ...(isAdmin ? ["*"] : [])].map(String)
  );
  const userCanApproveSwap = (swap: typeof pendingApproval[0]) =>
    isAdmin || managedTeamIds.includes(swap.originalShift.policy.teamId);

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

      {/* Pending manager approval */}
      {pendingApproval.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-orange-600 uppercase tracking-wide">
            Chờ bạn phê duyệt ({pendingApproval.length})
          </h2>
          {pendingApproval.map((swap) => (
            <SwapCard
              key={swap.id}
              swap={swap}
              currentUserId={currentUser.id}
              canApprove={userCanApproveSwap(swap)}
              statusLabels={STATUS_LABELS}
            />
          ))}
        </section>
      )}

      {/* My active swaps */}
      {activeSwaps.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide">Đang chờ xử lý</h2>
          {activeSwaps.map((swap) => (
            <SwapCard
              key={swap.id}
              swap={swap}
              currentUserId={currentUser.id}
              canApprove={
                swap.status === SwapStatus.ACCEPTED_BY_TARGET &&
                (isAdmin || managedTeamIds.includes(swap.originalShift.policy.teamId))
              }
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
              canApprove={false}
              statusLabels={STATUS_LABELS}
            />
          ))}
        </section>
      )}

      {mySwaps.length === 0 && pendingApproval.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          Chưa có yêu cầu đổi ca nào.
        </div>
      )}
    </div>
  );
}
