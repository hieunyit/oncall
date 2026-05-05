import { Worker, Job } from "bullmq";
import { createRedisConnection } from "@/lib/redis";
import { QUEUE_NAMES } from "@/lib/queue/queues";
import type {
  ConfirmationReminderJobPayload,
  ReminderJobPayload,
  ShiftEndReminderJobPayload,
} from "@/lib/queue/jobs";
import { prisma } from "@/lib/prisma";
import { ConfirmationStatus, ChannelType, DeliveryStatus } from "@/app/generated/prisma/client";
import { emailQueue, telegramQueue, teamsQueue } from "@/lib/queue/queues";
import { getPolicyTelegramOptions } from "@/lib/rotation/policy-telegram-options";

async function processConfirmationReminder(jobData: ConfirmationReminderJobPayload) {
  const { shiftId, confirmationId, recipientId } = jobData;

  const confirmation = await prisma.shiftConfirmation.findUnique({
    where: { id: confirmationId },
    include: {
      shift: {
        include: {
          policy: { select: { id: true, name: true, teamId: true } },
        },
      },
      user: {
        select: {
          id: true,
          email: true,
          fullName: true,
          telegramChatId: true,
        },
      },
    },
  });

  if (!confirmation) return;
  if (confirmation.status !== ConfirmationStatus.PENDING) return;

  const { user, shift } = confirmation;
  const options = await getPolicyTelegramOptions(shift.policy.id);

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
    confirmationId: confirmation.id,
    confirmationToken: confirmation.token,
    requirePhotoOnConfirm: options.requirePhotoOnConfirm ? "1" : "0",
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
  };

  if (user.email) {
    const delivery = await prisma.notificationDelivery.create({
      data: { messageId: message.id, channelType: ChannelType.EMAIL, status: DeliveryStatus.QUEUED },
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

  if (user.telegramChatId) {
    const delivery = await prisma.notificationDelivery.create({
      data: { messageId: message.id, channelType: ChannelType.TELEGRAM, status: DeliveryStatus.QUEUED },
    });
    await telegramQueue.add("send-reminder-telegram", {
      deliveryId: delivery.id,
      messageId: message.id,
      chatId: user.telegramChatId.toString(),
      templateId: "shift-reminder",
      variables,
    });
  }

  const channelVariables = {
    recipientName: user.fullName,
    shiftStart: shift.startsAt.toISOString(),
    shiftEnd: shift.endsAt.toISOString(),
    policyName: shift.policy.name,
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
  };

  const telegramChannels = await prisma.teamNotificationChannel.findMany({
    where: { teamId: shift.policy.teamId, type: ChannelType.TELEGRAM },
  });
  for (const channel of telegramChannels) {
    const cfg = channel.configJson as Record<string, string>;
    const chatId = cfg.chatId;
    if (!chatId) continue;
    const delivery = await prisma.notificationDelivery.create({
      data: { messageId: message.id, channelType: ChannelType.TELEGRAM, status: DeliveryStatus.QUEUED },
    });
    await telegramQueue.add("send-reminder-telegram-channel", {
      deliveryId: delivery.id,
      messageId: message.id,
      chatId,
      templateId: "shift-reminder",
      variables: channelVariables,
    });
  }

  const teamsChannels = await prisma.teamNotificationChannel.findMany({
    where: { teamId: shift.policy.teamId, type: ChannelType.TEAMS },
  });

  for (const channel of teamsChannels) {
    const cfg = channel.configJson as Record<string, string>;
    const webhookUrl = cfg.webhookUrl;
    if (!webhookUrl) continue;

    const delivery = await prisma.notificationDelivery.create({
      data: { messageId: message.id, channelType: ChannelType.TEAMS, status: DeliveryStatus.QUEUED },
    });
    await teamsQueue.add("send-reminder-teams", {
      deliveryId: delivery.id,
      messageId: message.id,
      webhookUrl,
      templateId: "shift-reminder",
      variables,
    });
  }
}

async function processShiftEndReminder(jobData: ShiftEndReminderJobPayload) {
  const { shiftId, recipientId } = jobData;

  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    include: {
      assignee: {
        select: {
          id: true,
          fullName: true,
          telegramChatId: true,
        },
      },
      policy: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });
  if (!shift) return;
  if (shift.assigneeId !== recipientId) return;

  const options = await getPolicyTelegramOptions(shift.policy.id);
  if (!options.endShiftReminderEnabled) return;
  if (!shift.assignee.telegramChatId) return;

  const message = await prisma.notificationMessage.create({
    data: {
      shiftId,
      recipientId,
      channelType: ChannelType.TELEGRAM,
      eventType: "SHIFT_END_REMINDER",
      templateId: "shift-end-reminder",
      payloadJson: {
        shiftId,
        requirePhotoOnCheckout: options.requirePhotoOnCheckout,
      },
    },
  });

  const delivery = await prisma.notificationDelivery.create({
    data: { messageId: message.id, channelType: ChannelType.TELEGRAM, status: DeliveryStatus.QUEUED },
  });

  await telegramQueue.add("send-shift-end-reminder-telegram", {
    deliveryId: delivery.id,
    messageId: message.id,
    chatId: shift.assignee.telegramChatId.toString(),
    templateId: "shift-end-reminder",
    variables: {
      recipientName: shift.assignee.fullName,
      shiftStart: shift.startsAt.toISOString(),
      shiftEnd: shift.endsAt.toISOString(),
      policyName: shift.policy.name,
      shiftId: shift.id,
      requirePhotoOnCheckout: options.requirePhotoOnCheckout ? "1" : "0",
      appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
    },
  });
}

export function startReminderWorker() {
  const worker = new Worker<ReminderJobPayload>(
    QUEUE_NAMES.REMINDER,
    async (job: Job<ReminderJobPayload>) => {
      if (job.data.kind === "SHIFT_END_REMINDER") {
        await processShiftEndReminder(job.data);
        return;
      }

      await processConfirmationReminder(job.data as ConfirmationReminderJobPayload);
    },
    { connection: createRedisConnection(), concurrency: 10 }
  );

  worker.on("failed", (job, err) => {
    console.error(`Reminder job ${job?.id} failed:`, err);
  });

  return worker;
}
