import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/rbac";
import { ok, unauthorized, forbidden, notFound, conflict, badRequest, handleError } from "@/lib/api-response";
import { SwapStatus, ShiftStatus } from "@/app/generated/prisma/client";
import { writeAuditLog } from "@/lib/audit";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const { id } = await params;
    const swap = await prisma.swapRequest.findUnique({
      where: { id },
      include: {
        originalShift: { include: { policy: { select: { teamId: true } } } },
      },
    });
    if (!swap) return notFound("Swap request not found");

    // Only open swaps (no target) can be taken via this endpoint
    if (swap.targetUserId !== null) {
      return badRequest("This swap is targeted at a specific person");
    }

    if (swap.requesterId === actor.id) {
      return forbidden("Cannot take your own swap request");
    }

    if (swap.status !== SwapStatus.REQUESTED) {
      return conflict(`Swap is already ${swap.status}`, "INVALID_STATE");
    }

    if (new Date() > swap.expiresAt) {
      await prisma.swapRequest.update({ where: { id }, data: { status: SwapStatus.EXPIRED } });
      return conflict("Swap request has expired", "EXPIRED");
    }

    // Verify taker is on the same team as the original shift
    const membership = await prisma.teamMember.findFirst({
      where: {
        userId: actor.id,
        teamId: swap.originalShift.policy.teamId,
      },
    });
    if (!membership) {
      return forbidden("You are not a member of this team");
    }

    // Cross-policy constraint: taker must not have a shift from a DIFFERENT policy
    // in the same team that overlaps with the shift being taken.
    const crossPolicyConflict = await prisma.shift.findFirst({
      where: {
        assigneeId: actor.id,
        policyId: { not: swap.originalShift.policyId },
        policy: { teamId: swap.originalShift.policy.teamId },
        status: { in: [ShiftStatus.PUBLISHED, ShiftStatus.ACTIVE] },
        startsAt: { lt: swap.originalShift.endsAt },
        endsAt: { gt: swap.originalShift.startsAt },
      },
      select: { id: true },
    });
    if (crossPolicyConflict) {
      return conflict(
        "You already have a shift from another policy that overlaps this time slot",
        "CROSS_POLICY_CONFLICT"
      );
    }

    const updated = await prisma.swapRequest.update({
      where: { id },
      data: {
        targetUserId: actor.id,
        status: SwapStatus.ACCEPTED_BY_TARGET,
        version: { increment: 1 },
      },
    });

    await writeAuditLog({
      actorId: actor.id,
      entityType: "SwapRequest",
      entityId: id,
      action: "TAKE",
      oldValue: { status: swap.status, targetUserId: null },
      newValue: { status: SwapStatus.ACCEPTED_BY_TARGET, targetUserId: actor.id },
    });

    return ok(updated);
  } catch (error) {
    return handleError(error);
  }
}
