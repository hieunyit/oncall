import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { ShiftStatus, SwapStatus } from "@/app/generated/prisma/client";
import { SwapCard } from "./swap-card";
import { CreateSwapButton } from "./create-swap-button";

export const metadata = { title: "Đổi ca" };

export const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  REQUESTED:          { label: "Đang tìm người nhận", color: "bg-yellow-100 text-yellow-700" },
  ACCEPTED_BY_TARGET: { label: "Chờ quản lý duyệt",  color: "bg-blue-100 text-blue-700"   },
  APPROVED:           { label: "Đã phê duyệt",        color: "bg-green-100 text-green-700"  },
  REJECTED:           { label: "Bị từ chối",          color: "bg-red-100 text-red-700"      },
  CANCELLED:          { label: "Đã hủy",              color: "bg-gray-100 text-gray-500"    },
  EXPIRED:            { label: "Hết hạn",             color: "bg-gray-100 text-gray-400"    },
};

const swapInclude = {
  requester:     { select: { id: true, fullName: true } },
  targetUser:    { select: { id: true, fullName: true } },
  originalShift: { include: { policy: { select: { name: true, teamId: true } } } },
  targetShift:   { include: { policy: { select: { name: true } } } },
} as const;

type SwapWithRelations = {
  id: string;
  status: string;
  requesterId: string;
  targetUserId: string | null;
  expiresAt: Date;
  requesterNote: string | null;
  targetNote: string | null;
  managerNote: string | null;
  requester: { id: string; fullName: string };
  targetUser: { id: string; fullName: string } | null;
  originalShift: { startsAt: Date; endsAt: Date; policy: { name: string; teamId: string } };
  targetShift: { startsAt: Date; endsAt: Date; policy: { name: string } } | null;
};

export default async function SwapsPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: {
      id: true,
      systemRole: true,
      teamMembers: { select: { teamId: true, role: true } },
    },
  });
  if (!currentUser) redirect("/login");

  const isAdmin = currentUser.systemRole === "ADMIN";
  const managedTeamIds = currentUser.teamMembers
    .filter((m) => m.role === "MANAGER")
    .map((m) => m.teamId);
  const myTeamIds = currentUser.teamMembers.map((m) => m.teamId);
  const isManager = managedTeamIds.length > 0;

  const activeStatuses: string[] = [SwapStatus.REQUESTED, SwapStatus.ACCEPTED_BY_TARGET];

  const [mySwaps, availableSwaps, pendingApproval, myUpcomingShifts] = await Promise.all([
    // My own swaps (I created or am targeted in)
    prisma.swapRequest.findMany({
      where: {
        OR: [{ requesterId: currentUser.id }, { targetUserId: currentUser.id }],
      },
      include: swapInclude,
      orderBy: { createdAt: "desc" },
      take: 50,
    }) as unknown as Promise<SwapWithRelations[]>,

    // Open swaps from teammates that I can take (targetUserId IS NULL = open request)
    prisma.swapRequest.findMany({
      where: {
        status: SwapStatus.REQUESTED,
        targetUserId: null as any,       // nullable after migration 5 — null as any bypasses generated-client type
        requesterId: { not: currentUser.id },
        expiresAt: { gt: new Date() },
        originalShift: {
          policy: { teamId: { in: myTeamIds } },
        },
      } as any,
      include: swapInclude,
      orderBy: { createdAt: "desc" },
      take: 20,
    }).catch(() => [] as SwapWithRelations[]) as unknown as Promise<SwapWithRelations[]>,

    // Swaps waiting for manager approval
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
      : Promise.resolve([] as SwapWithRelations[]),

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

  const activeSwaps  = mySwaps.filter((s) => activeStatuses.includes(s.status));
  const historySwaps = mySwaps.filter((s) => !activeStatuses.includes(s.status));

  const userCanApproveSwap = (swap: typeof pendingApproval[0]) =>
    isAdmin || managedTeamIds.includes(swap.originalShift.policy.teamId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Đổi ca</h1>
          <p className="text-sm text-gray-500 mt-0.5">Đăng yêu cầu hoặc nhận ca của đồng nghiệp</p>
        </div>
        <CreateSwapButton
          myShifts={myUpcomingShifts.map((s) => ({
            id: s.id,
            label: `${s.policy.name} — ${format(s.startsAt, "EEE dd/MM HH:mm", { locale: vi })}`,
          }))}
        />
      </div>

      {/* Available open swaps to take */}
      {availableSwaps.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
            </span>
            <h2 className="text-sm font-semibold text-green-700 uppercase tracking-wide">
              Đồng nghiệp cần người nhận ca ({availableSwaps.length})
            </h2>
          </div>
          <div className="space-y-2">
            {availableSwaps.map((swap) => (
              <SwapCard
                key={swap.id}
                swap={swap}
                currentUserId={currentUser.id}
                canApprove={false}
                canTake={true}
                statusLabels={STATUS_LABELS}
              />
            ))}
          </div>
        </section>
      )}

      {/* Pending manager approval */}
      {pendingApproval.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-orange-600 uppercase tracking-wide">
            Chờ bạn phê duyệt ({pendingApproval.length})
          </h2>
          {pendingApproval.map((swap) => (
            <SwapCard
              key={swap.id}
              swap={swap}
              currentUserId={currentUser.id}
              canApprove={userCanApproveSwap(swap)}
              canTake={false}
              statusLabels={STATUS_LABELS}
            />
          ))}
        </section>
      )}

      {/* My active swaps */}
      {activeSwaps.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Của tôi — đang chờ</h2>
          {activeSwaps.map((swap) => (
            <SwapCard
              key={swap.id}
              swap={swap}
              currentUserId={currentUser.id}
              canApprove={
                swap.status === SwapStatus.ACCEPTED_BY_TARGET &&
                (isAdmin || managedTeamIds.includes(swap.originalShift.policy.teamId))
              }
              canTake={false}
              statusLabels={STATUS_LABELS}
            />
          ))}
        </section>
      )}

      {/* History */}
      {historySwaps.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Lịch sử</h2>
          {historySwaps.map((swap) => (
            <SwapCard
              key={swap.id}
              swap={swap}
              currentUserId={currentUser.id}
              canApprove={false}
              canTake={false}
              statusLabels={STATUS_LABELS}
            />
          ))}
        </section>
      )}

      {mySwaps.length === 0 && availableSwaps.length === 0 && pendingApproval.length === 0 && (
        <div className="text-center py-16 text-gray-400 text-sm">
          Chưa có yêu cầu đổi ca nào.
        </div>
      )}
    </div>
  );
}
