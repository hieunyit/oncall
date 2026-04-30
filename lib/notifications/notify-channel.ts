import { prisma } from "@/lib/prisma";
import { ChannelType, DeliveryStatus } from "@/app/generated/prisma/client";
import { telegramQueue } from "@/lib/queue/queues";
import { renderTelegramMessage, sendTelegramMessage } from "@/lib/notifications/telegram";

async function enqueueOrSendTelegramDirect(input: {
  deliveryId: string;
  messageId: string;
  chatId: string;
  templateId: string;
  variables: Record<string, string>;
}) {
  try {
    await telegramQueue.add(input.templateId, {
      deliveryId: input.deliveryId,
      messageId: input.messageId,
      chatId: input.chatId,
      templateId: input.templateId,
      variables: input.variables,
    });
  } catch (queueError) {
    await prisma.notificationDelivery.update({
      where: { id: input.deliveryId },
      data: {
        status: DeliveryStatus.RETRYING,
        attemptCount: { increment: 1 },
        lastAttemptAt: new Date(),
        errorJson: { message: `Queue unavailable: ${(queueError as Error).message}` },
      },
    });

    const text = renderTelegramMessage(input.templateId, input.variables);
    const result = await sendTelegramMessage(input.chatId, text, "HTML");
    if (!result.ok) {
      await prisma.notificationDelivery.update({
        where: { id: input.deliveryId },
        data: {
          status: DeliveryStatus.FAILED,
          errorJson: { message: result.description ?? "Telegram API error" },
        },
      });
      throw new Error(result.description ?? "Telegram API error");
    }

    await prisma.notificationDelivery.update({
      where: { id: input.deliveryId },
      data: {
        status: DeliveryStatus.SENT,
        externalId:
          result.result?.message_id != null
            ? `${input.chatId}|${result.result.message_id}`
            : null,
      },
    });
  }
}

export async function notifyTeamChannels({
  teamId,
  eventType,
  templateId,
  variables,
  recipientId,
}: {
  teamId: string;
  eventType: string;
  templateId: string;
  variables: Record<string, string>;
  recipientId: string;
}) {
  const channels = await prisma.teamNotificationChannel.findMany({
    where: { teamId, type: ChannelType.TELEGRAM, isActive: true },
  });

  for (const channel of channels) {
    const cfg = channel.configJson as Record<string, string>;
    const chatId = cfg.chatId;
    if (!chatId) continue;

    const msg = await prisma.notificationMessage.create({
      data: {
        recipientId,
        channelType: ChannelType.TELEGRAM,
        eventType,
        templateId,
        payloadJson: { channelId: channel.id, ...variables },
      },
    });

    const delivery = await prisma.notificationDelivery.create({
      data: { messageId: msg.id, channelType: ChannelType.TELEGRAM, status: DeliveryStatus.QUEUED },
    });

    await enqueueOrSendTelegramDirect({
      deliveryId: delivery.id,
      messageId: msg.id,
      chatId,
      templateId,
      variables,
    });
  }
}
