import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/rbac";
import { ok, unauthorized, forbidden, notFound, badRequest, handleError } from "@/lib/api-response";
import { SystemRole, DeliveryStatus, ChannelType } from "@/app/generated/prisma/client";
import { emailQueue, telegramQueue, teamsQueue } from "@/lib/queue/queues";
import { writeAuditLog } from "@/lib/audit";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const idempotencyKey = req.headers.get("Idempotency-Key");
  if (!idempotencyKey) {
    return badRequest("Idempotency-Key header required for manual resend");
  }

  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();
    if (actor.systemRole !== SystemRole.ADMIN) return forbidden();

    const { id } = await params;
    const delivery = await prisma.notificationDelivery.findUnique({
      where: { id },
      include: {
        message: {
          select: {
            id: true,
            eventType: true,
            templateId: true,
            channelType: true,
            payloadJson: true,
            recipientId: true,
          },
        },
      },
    });

    if (!delivery) return notFound("Delivery not found");

    if (delivery.status === DeliveryStatus.SENT || delivery.status === DeliveryStatus.DELIVERED) {
      return badRequest("Delivery already succeeded");
    }

    // Reset to QUEUED and re-enqueue
    await prisma.notificationDelivery.update({
      where: { id },
      data: { status: DeliveryStatus.QUEUED, attemptCount: 0, errorJson: undefined },
    });

    const recipient = await prisma.user.findUnique({
      where: { id: delivery.message.recipientId },
      select: { email: true, telegramChatId: true, teamsConversationId: true, fullName: true },
    });

    const variables = {
      ...(delivery.message.payloadJson as Record<string, string>),
      recipientName: recipient?.fullName ?? "",
      appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
    };

    switch (delivery.channelType) {
      case ChannelType.EMAIL:
        if (recipient?.email) {
          await emailQueue.add(`resend-${id}`, {
            deliveryId: id,
            messageId: delivery.message.id,
            to: recipient.email,
            subject: "On-Call Notification",
            templateId: delivery.message.templateId,
            variables,
          });
        }
        break;
      case ChannelType.TELEGRAM:
        if (recipient?.telegramChatId) {
          await telegramQueue.add(`resend-${id}`, {
            deliveryId: id,
            messageId: delivery.message.id,
            chatId: recipient.telegramChatId.toString(),
            templateId: delivery.message.templateId,
            variables,
          });
        }
        break;
    }

    await writeAuditLog({
      actorId: actor.id,
      entityType: "NotificationDelivery",
      entityId: id,
      action: "MANUAL_RESEND",
      ipAddress: req.headers.get("x-forwarded-for") ?? undefined,
    });

    return ok({ deliveryId: id, status: DeliveryStatus.QUEUED });
  } catch (error) {
    return handleError(error);
  }
}
