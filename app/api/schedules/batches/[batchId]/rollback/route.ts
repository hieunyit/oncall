import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, requireTeamRole, isNextResponse } from "@/lib/rbac";
import { ok, unauthorized, notFound, conflict, handleError } from "@/lib/api-response";
import { BatchStatus, ShiftStatus, SwapStatus, TeamRole } from "@/app/generated/prisma/client";
import { writeAuditLog } from "@/lib/audit";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const { batchId } = await params;

    const batch = await prisma.scheduleBatch.findUnique({
      where: { id: batchId },
      include: { policy: { select: { teamId: true } } },
    });

    if (!batch) return notFound("Batch not found");
    if (batch.status !== BatchStatus.PUBLISHED) {
      return conflict("Only PUBLISHED batches can be rolled back", "BATCH_NOT_PUBLISHED");
    }

    const result = await requireTeamRole(batch.policy.teamId, TeamRole.MANAGER);
    if (isNextResponse(result)) return result;

    // Check if any shifts in the batch are ACTIVE or COMPLETED — cannot roll those back
    const activeOrCompleted = await prisma.shift.count({
      where: {
        batchId,
        status: { in: [ShiftStatus.ACTIVE, ShiftStatus.COMPLETED] },
      },
    });

    if (activeOrCompleted > 0) {
      return conflict(
        `Cannot roll back: ${activeOrCompleted} shift(s) are ACTIVE or COMPLETED`,
        "SHIFTS_ACTIVE"
      );
    }

    await prisma.$transaction(async (tx) => {
      // Fetch shift IDs before cancelling so we can cancel related swap requests
      const shiftIds = (
        await tx.shift.findMany({
          where: { batchId, status: { in: [ShiftStatus.PUBLISHED, ShiftStatus.DRAFT] } },
          select: { id: true },
        })
      ).map((s) => s.id);

      // Cancel any open or accepted swap requests that reference these shifts
      if (shiftIds.length > 0) {
        await tx.swapRequest.updateMany({
          where: {
            status: { in: [SwapStatus.REQUESTED, SwapStatus.ACCEPTED_BY_TARGET] },
            OR: [
              { originalShiftId: { in: shiftIds } },
              { targetShiftId: { in: shiftIds } },
            ],
          },
          data: { status: SwapStatus.CANCELLED, version: { increment: 1 } },
        });
      }

      await tx.shift.updateMany({
        where: { batchId, status: { in: [ShiftStatus.PUBLISHED, ShiftStatus.DRAFT] } },
        data: { status: ShiftStatus.CANCELLED },
      });

      await tx.scheduleBatch.update({
        where: { id: batchId },
        data: { status: BatchStatus.ROLLED_BACK },
      });
    });

    await writeAuditLog({
      actorId: actor.id,
      entityType: "ScheduleBatch",
      entityId: batchId,
      action: "ROLLBACK",
      ipAddress: req.headers.get("x-forwarded-for") ?? undefined,
    });

    return ok({ batchId, status: BatchStatus.ROLLED_BACK });
  } catch (error) {
    return handleError(error);
  }
}
