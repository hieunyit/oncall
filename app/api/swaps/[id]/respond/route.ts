import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/rbac";
import {
  ok,
  unauthorized,
  forbidden,
  badRequest,
  notFound,
  conflict,
  handleError,
} from "@/lib/api-response";
import { SwapStatus } from "@/app/generated/prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { validateSwapAssignmentConstraints } from "@/lib/rotation/swap-constraints";

const RespondSchema = z.object({
  action: z.enum(["accept", "decline", "cancel"]),
  note: z.string().max(500).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const { id } = await params;
    const swap = await prisma.swapRequest.findUnique({
      where: { id },
      include: {
        originalShift: { include: { policy: { select: { teamId: true, timezone: true } } } },
        targetShift: { select: { id: true } },
      },
    });
    if (!swap) return notFound("Swap request not found");

    const body = await req.json();
    const { action, note } = RespondSchema.parse(body);

    // cancel: only the requester can cancel their own pending request
    if (action === "cancel") {
      if (swap.requesterId !== actor.id) return forbidden("Only the requester can cancel their swap request");
      if (swap.status !== SwapStatus.REQUESTED) {
        return conflict(`Cannot cancel a swap in state ${swap.status}`, "INVALID_STATE");
      }
      const updatedCount = await prisma.swapRequest.updateMany({
        where: { id, requesterId: actor.id, status: SwapStatus.REQUESTED },
        data: { status: SwapStatus.CANCELLED, version: { increment: 1 } },
      });
      if (updatedCount.count === 0) {
        return conflict("Swap was changed by another request. Reload and retry.", "INVALID_STATE");
      }
      const updated = await prisma.swapRequest.findUnique({ where: { id } });
      if (!updated) return notFound("Swap request not found");
      await writeAuditLog({
        actorId: actor.id, entityType: "SwapRequest", entityId: id,
        action: "CANCEL", oldValue: { status: swap.status }, newValue: { status: SwapStatus.CANCELLED },
      });
      return ok(updated);
    }

    // accept / decline: only the targeted user can respond
    if (swap.targetUserId === null) return badRequest("Use /take for open swap requests");
    if (swap.targetUserId !== actor.id) return forbidden();

    if (swap.status !== SwapStatus.REQUESTED) {
      return conflict(`Swap is already ${swap.status}`, "INVALID_STATE");
    }

    const now = new Date();
    if (now > swap.expiresAt) {
      await prisma.swapRequest.updateMany({
        where: { id, status: SwapStatus.REQUESTED },
        data: { status: SwapStatus.EXPIRED },
      });
      return conflict("Swap request has expired", "EXPIRED");
    }

    if (action === "accept") {
      const constraintViolation = await validateSwapAssignmentConstraints({
        userId: actor.id,
        teamId: swap.originalShift.policy.teamId,
        startsAt: swap.originalShift.startsAt,
        endsAt: swap.originalShift.endsAt,
        timezone: swap.originalShift.policy.timezone,
        excludeShiftIds: swap.targetShift ? [swap.targetShift.id] : [],
        allowConsecutive: true,
        allowConsecutiveNight: true,
      });
      if (constraintViolation) {
        return conflict(constraintViolation.message, constraintViolation.code);
      }
    }

    const newStatus = action === "accept" ? SwapStatus.ACCEPTED_BY_TARGET : SwapStatus.REJECTED;

    const updatedCount = await prisma.swapRequest.updateMany({
      where: {
        id,
        targetUserId: actor.id,
        status: SwapStatus.REQUESTED,
        expiresAt: { gt: now },
      },
      data: { status: newStatus, targetNote: note, version: { increment: 1 } },
    });
    if (updatedCount.count === 0) {
      const latest = await prisma.swapRequest.findUnique({ where: { id }, select: { status: true, expiresAt: true } });
      if (latest && latest.expiresAt <= now) {
        return conflict("Swap request has expired", "EXPIRED");
      }
      return conflict("Swap was changed by another request. Reload and retry.", "INVALID_STATE");
    }
    const updated = await prisma.swapRequest.findUnique({ where: { id } });
    if (!updated) return notFound("Swap request not found");

    await writeAuditLog({
      actorId: actor.id, entityType: "SwapRequest", entityId: id,
      action: action.toUpperCase(),
      oldValue: { status: swap.status }, newValue: { status: newStatus },
    });

    return ok(updated);
  } catch (error) {
    return handleError(error);
  }
}
