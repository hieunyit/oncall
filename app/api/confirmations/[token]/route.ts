import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, conflict, handleError } from "@/lib/api-response";
import { ConfirmationStatus } from "@/app/generated/prisma/client";
import { writeAuditLog } from "@/lib/audit";

const RespondSchema = z.object({
  action: z.enum(["confirm", "decline"]),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const confirmation = await prisma.shiftConfirmation.findUnique({
      where: { token },
      include: {
        shift: {
          include: {
            assignee: { select: { id: true, fullName: true, email: true } },
            policy: { select: { name: true } },
          },
        },
      },
    });

    if (!confirmation) return notFound("Confirmation not found");
    return ok(confirmation);
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const confirmation = await prisma.shiftConfirmation.findUnique({
      where: { token },
    });

    if (!confirmation) return notFound("Confirmation not found");

    if (confirmation.status !== ConfirmationStatus.PENDING) {
      return conflict(
        `Confirmation already ${confirmation.status.toLowerCase()}`,
        "ALREADY_RESPONDED"
      );
    }

    if (new Date() > confirmation.dueAt) {
      await prisma.shiftConfirmation.update({
        where: { token },
        data: { status: ConfirmationStatus.EXPIRED },
      });
      return badRequest("Confirmation has expired");
    }

    const body = await req.json();
    const { action } = RespondSchema.parse(body);

    const newStatus =
      action === "confirm" ? ConfirmationStatus.CONFIRMED : ConfirmationStatus.DECLINED;

    const updated = await prisma.shiftConfirmation.update({
      where: { token },
      data: { status: newStatus, respondedAt: new Date() },
    });

    await writeAuditLog({
      entityType: "ShiftConfirmation",
      entityId: confirmation.id,
      action: action === "confirm" ? "CONFIRM" : "DECLINE",
      oldValue: { status: confirmation.status },
      newValue: { status: newStatus },
    });

    return ok(updated);
  } catch (error) {
    return handleError(error);
  }
}
