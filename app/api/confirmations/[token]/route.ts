import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, conflict, handleError } from "@/lib/api-response";
import { ChannelType, ConfirmationStatus, DeliveryStatus } from "@/app/generated/prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { notifyTeamChannels } from "@/lib/notifications/notify-channel";
import { editTelegramDeliveries } from "@/lib/notifications/telegram";

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
      include: {
        shift: {
          include: {
            assignee: { select: { id: true, fullName: true } },
            policy: { select: { name: true, teamId: true } },
          },
        },
      },
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

    // Notify team channels
    notifyTeamChannels({
      teamId: confirmation.shift.policy.teamId,
      eventType: newStatus === ConfirmationStatus.CONFIRMED ? "SHIFT_CONFIRMED" : "SHIFT_DECLINED",
      templateId: newStatus === ConfirmationStatus.CONFIRMED ? "shift-confirmed" : "shift-declined",
      recipientId: confirmation.userId,
      variables: {
        recipientName: confirmation.shift.assignee.fullName,
        policyName: confirmation.shift.policy.name,
        shiftStart: confirmation.shift.startsAt.toISOString(),
        shiftEnd: confirmation.shift.endsAt.toISOString(),
        appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
      },
    }).catch((e) => console.error("notify team channels failed:", e));

    // Edit personal Telegram messages for this shift to remove confirm/decline buttons
    const fmtVN = (d: Date) => d.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
    const icon = action === "confirm" ? "✅" : "❌";
    const label = action === "confirm" ? "Đã xác nhận" : "Đã từ chối";
    const editedText = [
      `${icon} <b>${label} ca trực</b>`,
      ``,
      `Ca: <b>${confirmation.shift.policy.name}</b>`,
      `Bắt đầu: ${fmtVN(confirmation.shift.startsAt)}`,
      `Kết thúc: ${fmtVN(confirmation.shift.endsAt)}`,
      ``,
      `Người thực hiện: ${confirmation.shift.assignee.fullName}`,
    ].join("\n");

    prisma.notificationDelivery
      .findMany({
        where: {
          channelType: ChannelType.TELEGRAM,
          status: DeliveryStatus.SENT,
          externalId: { not: null },
          message: { shiftId: confirmation.shiftId },
        },
        select: { externalId: true },
      })
      .then((deliveries) => editTelegramDeliveries(deliveries, editedText))
      .catch(() => {});

    return ok(updated);
  } catch (error) {
    return handleError(error);
  }
}
