import { Worker, Job } from "bullmq";
import { createRedisConnection } from "@/lib/redis";
import { QUEUE_NAMES } from "@/lib/queue/queues";
import type { TelegramJobPayload } from "@/lib/queue/jobs";
import { prisma } from "@/lib/prisma";
import { DeliveryStatus } from "@/app/generated/prisma/client";
import { sendTelegramMessage, renderTelegramMessage, buildInlineKeyboard } from "@/lib/notifications/telegram";

export function startTelegramWorker() {
  const worker = new Worker<TelegramJobPayload>(
    QUEUE_NAMES.TELEGRAM,
    async (job: Job<TelegramJobPayload>) => {
      const { deliveryId, chatId, templateId, variables } = job.data;

      await prisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: {
          status: DeliveryStatus.RETRYING,
          attemptCount: { increment: 1 },
          lastAttemptAt: new Date(),
        },
      });

      try {
        const text = renderTelegramMessage(templateId, variables);
        const keyboard = buildInlineKeyboard(templateId, variables);
        const result = await sendTelegramMessage(chatId, text, "HTML", keyboard);

        if (!result.ok) throw new Error(result.description ?? "Telegram API error");

        await prisma.notificationDelivery.update({
          where: { id: deliveryId },
          data: {
            status: DeliveryStatus.SENT,
            externalId: result.result?.message_id?.toString() ?? null,
          },
        });
      } catch (err) {
        await prisma.notificationDelivery.update({
          where: { id: deliveryId },
          data: {
            status: DeliveryStatus.FAILED,
            errorJson: { message: (err as Error).message },
          },
        });
        throw err;
      }
    },
    { connection: createRedisConnection(), concurrency: 10 }
  );

  worker.on("failed", (job, err) => {
    console.error(`Telegram job ${job?.id} failed:`, err);
  });

  return worker;
}
