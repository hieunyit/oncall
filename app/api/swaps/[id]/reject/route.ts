import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser, requireTeamRole, isNextResponse } from "@/lib/rbac";
import { ok, unauthorized, notFound, conflict, handleError } from "@/lib/api-response";
import { SwapStatus, TeamRole } from "@/app/generated/prisma/client";
import { writeAuditLog } from "@/lib/audit";

const RejectSchema = z.object({
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
      include: { originalShift: { include: { policy: { select: { teamId: true } } } } },
    });
    if (!swap) return notFound("Swap request not found");

    const terminal: string[] = [SwapStatus.APPROVED, SwapStatus.CANCELLED, SwapStatus.EXPIRED];
    if (terminal.includes(swap.status)) {
      return conflict(`Cannot reject a swap in state ${swap.status}`, "INVALID_STATE");
    }

    const result = await requireTeamRole(swap.originalShift.policy.teamId, TeamRole.MANAGER);
    if (isNextResponse(result)) return result;

    const body = await req.json().catch(() => ({}));
    const { note } = RejectSchema.parse(body);

    const updated = await prisma.swapRequest.update({
      where: { id },
      data: {
        status: SwapStatus.REJECTED,
        managerNote: note,
        version: { increment: 1 },
      },
    });

    await writeAuditLog({
      actorId: actor.id,
      entityType: "SwapRequest",
      entityId: id,
      action: "REJECT",
      oldValue: { status: swap.status },
      newValue: { status: SwapStatus.REJECTED },
    });

    return ok(updated);
  } catch (error) {
    return handleError(error);
  }
}
