import { Worker, Job } from "bullmq";
import { createRedisConnection } from "@/lib/redis";
import { QUEUE_NAMES } from "@/lib/queue/queues";
import type { TeamsJobPayload } from "@/lib/queue/jobs";
import { prisma } from "@/lib/prisma";
import { DeliveryStatus } from "@/app/generated/prisma/client";
import { buildTeamsAdaptiveCard, sendTeamsWebhook } from "@/lib/notifications/teams";

export function startTeamsWorker() {
  const worker = new Worker<TeamsJobPayload>(
    QUEUE_NAMES.TEAMS,
    async (job: Job<TeamsJobPayload>) => {
      const { deliveryId, webhookUrl, templateId, variables } = job.data;

      await prisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: {
          status: DeliveryStatus.RETRYING,
          attemptCount: { increment: 1 },
          lastAttemptAt: new Date(),
        },
      });

      try {
        const card = buildTeamsAdaptiveCard(templateId, variables);
        await sendTeamsWebhook(webhookUrl, card);

        await prisma.notificationDelivery.update({
          where: { id: deliveryId },
          data: { status: DeliveryStatus.SENT },
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
    { connection: createRedisConnection(), concurrency: 5 }
  );

  worker.on("failed", (job, err) => {
    console.error(`Teams job ${job?.id} failed:`, err);
  });

  return worker;
}
