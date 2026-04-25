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
import { SwapStatus, ShiftSource, TeamRole } from "@/app/generated/prisma/client";
import { writeAuditLog } from "@/lib/audit";

const ApproveSchema = z.object({
  note: z.string().max(500).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const idempotencyKey = req.headers.get("Idempotency-Key");

  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const { id } = await params;
    const swap = await prisma.swapRequest.findUnique({
      where: { id },
      include: {
        originalShift: { include: { policy: { select: { teamId: true } } } },
        targetShift: true,
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

    // Execute the swap atomically
    await prisma.$transaction(async (tx) => {
      // Reassign original shift to target user
      await tx.shift.update({
        where: { id: swap.originalShiftId },
        data: {
          assigneeId: swap.targetUserId,
          source: ShiftSource.SWAP,
          version: { increment: 1 },
        },
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
      }

      await tx.swapRequest.update({
        where: { id },
        data: {
          status: SwapStatus.APPROVED,
          managerNote: note,
          version: { increment: 1 },
        },
      });
    });

    await writeAuditLog({
      actorId: actor.id,
      entityType: "SwapRequest",
      entityId: id,
      action: "APPROVE",
      oldValue: { status: swap.status },
      newValue: { status: SwapStatus.APPROVED },
    });

    return ok({ swapId: id, status: SwapStatus.APPROVED });
  } catch (error) {
    return handleError(error);
  }
}
