import { Worker, Job } from "bullmq";
import { createRedisConnection } from "@/lib/redis";
import { QUEUE_NAMES } from "@/lib/queue/queues";
import type { ReminderJobPayload } from "@/lib/queue/jobs";
import { prisma } from "@/lib/prisma";
import { ConfirmationStatus, ChannelType, DeliveryStatus } from "@/app/generated/prisma/client";
import { emailQueue, telegramQueue, teamsQueue } from "@/lib/queue/queues";

export function startReminderWorker() {
  const worker = new Worker<ReminderJobPayload>(
    QUEUE_NAMES.REMINDER,
    async (job: Job<ReminderJobPayload>) => {
      const { shiftId, confirmationId, recipientId } = job.data;

      const confirmation = await prisma.shiftConfirmation.findUnique({
        where: { id: confirmationId },
        include: {
          shift: {
            include: {
              policy: { select: { name: true } },
            },
          },
          user: {
            select: {
              id: true,
              email: true,
              fullName: true,
              telegramChatId: true,
              teamsConversationId: true,
            },
          },
        },
      });

      if (!confirmation) return;
      if (confirmation.status !== ConfirmationStatus.PENDING) return;

      const { user, shift } = confirmation;

      // Create notification message (opaque IDs only in payload — no PII)
      const message = await prisma.notificationMessage.create({
        data: {
          shiftId,
          recipientId,
          channelType: ChannelType.EMAIL,
          eventType: "SHIFT_REMINDER",
          templateId: "shift-reminder",
          payloadJson: {
            shiftId,
            confirmationId,
            confirmationToken: confirmation.token,
          },
        },
      });

      const variables = {
        recipientName: user.fullName,
        shiftStart: shift.startsAt.toISOString(),
        shiftEnd: shift.endsAt.toISOString(),
        policyName: shift.policy.name,
        confirmationToken: confirmation.token,
        appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
      };

      // Queue email delivery
      if (user.email) {
        const delivery = await prisma.notificationDelivery.create({
          data: {
            messageId: message.id,
            channelType: ChannelType.EMAIL,
            status: DeliveryStatus.QUEUED,
          },
        });
        await emailQueue.add("send-reminder-email", {
          deliveryId: delivery.id,
          messageId: message.id,
          to: user.email,
          subject: `Nhắc nhở: Xác nhận ca trực ${shift.startsAt.toLocaleDateString("vi-VN")}`,
          templateId: "shift-reminder",
          variables,
        });
      }

      // Queue Telegram delivery if user has chat ID
      if (user.telegramChatId) {
        const delivery = await prisma.notificationDelivery.create({
          data: {
            messageId: message.id,
            channelType: ChannelType.TELEGRAM,
            status: DeliveryStatus.QUEUED,
          },
        });
        await telegramQueue.add("send-reminder-telegram", {
          deliveryId: delivery.id,
          messageId: message.id,
          chatId: user.telegramChatId.toString(),
          templateId: "shift-reminder",
          variables,
        });
      }

      // Queue Teams delivery if user has conversation ID
      if (user.teamsConversationId) {
        // Teams webhook URL would come from team channel config
      }
    },
    { connection: createRedisConnection(), concurrency: 10 }
  );

  worker.on("failed", (job, err) => {
    console.error(`Reminder job ${job?.id} failed:`, err);
  });

  return worker;
}
