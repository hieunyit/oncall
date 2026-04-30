import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser, requireTeamRole, isNextResponse } from "@/lib/rbac";
import {
  ok,
  unauthorized,
  notFound,
  conflict,
  handleError,
} from "@/lib/api-response";
import { SwapStatus, ShiftSource, ShiftStatus, TeamRole } from "@/app/generated/prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { notifyTeamChannels } from "@/lib/notifications/notify-channel";

const ApproveSchema = z.object({
  note: z.string().max(500).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const SWAP_STATE_CHANGED = "SWAP_STATE_CHANGED";

  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const { id } = await params;
    const swap = await prisma.swapRequest.findUnique({
      where: { id },
      include: {
        requester: { select: { id: true, fullName: true } },
        targetUser: { select: { id: true, fullName: true } },
        originalShift: {
          include: { policy: { select: { teamId: true, id: true, name: true } } },
        },
        targetShift: {
          include: { policy: { select: { teamId: true, id: true, name: true } } },
        },
      },
    });
    if (!swap) return notFound("Swap request not found");

    if (swap.status !== SwapStatus.ACCEPTED_BY_TARGET) {
      return conflict(`Swap must be ACCEPTED_BY_TARGET to approve. Current: ${swap.status}`, "INVALID_STATE");
    }

    const result = await requireTeamRole(swap.originalShift.policy.teamId, TeamRole.MANAGER);
    if (isNextResponse(result)) return result;

    const body = await req.json().catch(() => ({}));
    const { note } = ApproveSchema.parse(body);

    // Cross-policy constraint: the new assignee of each shift must not already have
    // a shift from a DIFFERENT policy (same team) that overlaps. Same-policy overlaps are allowed.
    const activeStatuses = [ShiftStatus.PUBLISHED, ShiftStatus.ACTIVE];

    // Target user is taking the original shift
    const conflict1 = await prisma.shift.findFirst({
      where: {
        assigneeId: swap.targetUserId!,
        policyId: { not: swap.originalShift.policyId },
        policy: { teamId: swap.originalShift.policy.teamId },
        status: { in: activeStatuses },
        startsAt: { lt: swap.originalShift.endsAt },
        endsAt: { gt: swap.originalShift.startsAt },
        // exclude the target shift itself (it's being swapped away)
        id: swap.targetShiftId ? { not: swap.targetShiftId } : undefined,
      },
      select: { id: true },
    });
    if (conflict1) {
      return conflict(
        "Target user already has a shift from another policy overlapping the original shift's time",
        "CROSS_POLICY_CONFLICT"
      );
    }

    // If mutual swap: requester is taking the target shift
    if (swap.targetShiftId && swap.targetShift) {
      const conflict2 = await prisma.shift.findFirst({
        where: {
          assigneeId: swap.requesterId,
          policyId: { not: swap.targetShift.policyId },
          policy: { teamId: swap.targetShift.policy.teamId },
          status: { in: activeStatuses },
          startsAt: { lt: swap.targetShift.endsAt },
          endsAt: { gt: swap.targetShift.startsAt },
          // exclude the original shift (it's being swapped away)
          id: { not: swap.originalShiftId },
        },
        select: { id: true },
      });
      if (conflict2) {
        return conflict(
          "Requester already has a shift from another policy overlapping the target shift's time",
          "CROSS_POLICY_CONFLICT"
        );
      }
    }

    // Execute the swap atomically
    await prisma.$transaction(async (tx) => {
      const approved = await tx.swapRequest.updateMany({
        where: { id, status: SwapStatus.ACCEPTED_BY_TARGET },
        data: {
          status: SwapStatus.APPROVED,
          managerNote: note,
          version: { increment: 1 },
        },
      });
      if (approved.count === 0) {
        throw new Error(SWAP_STATE_CHANGED);
      }

      // Reassign original shift to target user
      await tx.shift.update({
        where: { id: swap.originalShiftId },
        data: {
          assigneeId: swap.targetUserId!,
          source: ShiftSource.SWAP,
          version: { increment: 1 },
        },
      });

      // Transfer confirmation ownership to new assignee so reminders/escalations go to the right person
      await tx.shiftConfirmation.updateMany({
        where: { shiftId: swap.originalShiftId },
        data: { userId: swap.targetUserId! },
      });

      // If mutual swap, reassign target shift to requester
      if (swap.targetShiftId) {
        await tx.shift.update({
          where: { id: swap.targetShiftId },
          data: {
            assigneeId: swap.requesterId,
            source: ShiftSource.SWAP,
            version: { increment: 1 },
          },
        });

        await tx.shiftConfirmation.updateMany({
          where: { shiftId: swap.targetShiftId },
          data: { userId: swap.requesterId },
        });
      }
    });

    await writeAuditLog({
      actorId: actor.id,
      entityType: "SwapRequest",
      entityId: id,
      action: "APPROVE",
      oldValue: { status: swap.status },
      newValue: { status: SwapStatus.APPROVED },
    });

    // Notify team Telegram channels
    notifyTeamChannels({
      teamId: swap.originalShift.policy.teamId,
      eventType: "SWAP_APPROVED",
      templateId: "swap-approved",
      recipientId: actor.id,
      variables: {
        requesterName: swap.requester.fullName,
        targetName: swap.targetUser?.fullName ?? "—",
        policyName: swap.originalShift.policy.name,
        shiftDate: swap.originalShift.startsAt.toISOString(),
        appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
      },
    }).catch((e) => console.error("notify team channels failed:", e));

    return ok({ swapId: id, status: SwapStatus.APPROVED });
  } catch (error) {
    if (error instanceof Error && error.message === "SWAP_STATE_CHANGED") {
      return conflict("Swap was changed by another request. Reload and retry.", "INVALID_STATE");
    }
    return handleError(error);
  }
}
