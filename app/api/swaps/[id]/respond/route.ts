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

const RespondSchema = z.object({
  action: z.enum(["accept", "decline"]),
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
    const swap = await prisma.swapRequest.findUnique({ where: { id } });
    if (!swap) return notFound("Swap request not found");

    // Open swaps (targetUserId = null) must be taken via /take, not /respond
    if (swap.targetUserId === null) return badRequest("Use /take for open swap requests");
    if (swap.targetUserId !== actor.id) return forbidden();

    if (swap.status !== SwapStatus.REQUESTED) {
      return conflict(`Swap is already ${swap.status}`, "INVALID_STATE");
    }

    if (new Date() > swap.expiresAt) {
      await prisma.swapRequest.update({
        where: { id },
        data: { status: SwapStatus.EXPIRED },
      });
      return conflict("Swap request has expired", "EXPIRED");
    }

    const body = await req.json();
    const { action, note } = RespondSchema.parse(body);

    const newStatus =
      action === "accept" ? SwapStatus.ACCEPTED_BY_TARGET : SwapStatus.REJECTED;

    const updated = await prisma.swapRequest.update({
      where: { id },
      data: {
        status: newStatus,
        targetNote: note,
        version: { increment: 1 },
      },
    });

    await writeAuditLog({
      actorId: actor.id,
      entityType: "SwapRequest",
      entityId: id,
      action: action.toUpperCase(),
      oldValue: { status: swap.status },
      newValue: { status: newStatus },
    });

    return ok(updated);
  } catch (error) {
    return handleError(error);
  }
}
