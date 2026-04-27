import { prisma } from "@/lib/prisma";
import { ChannelType, DeliveryStatus } from "@/app/generated/prisma/client";
import { telegramQueue } from "@/lib/queue/queues";

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
    where: { teamId, type: ChannelType.TELEGRAM },
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

    await telegramQueue.add(templateId, {
      deliveryId: delivery.id,
      messageId: msg.id,
      chatId,
      templateId,
      variables,
    });
  }
}
