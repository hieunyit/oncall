import { Worker, Job } from "bullmq";
import { createRedisConnection } from "@/lib/redis";
import { QUEUE_NAMES } from "@/lib/queue/queues";
import type { EscalationJobPayload } from "@/lib/queue/jobs";
import { prisma } from "@/lib/prisma";
import { ConfirmationStatus, ChannelType, DeliveryStatus, EscalationTarget } from "@/app/generated/prisma/client";
import { emailQueue, telegramQueue, teamsQueue } from "@/lib/queue/queues";

export function startEscalationWorker() {
  const worker = new Worker<EscalationJobPayload>(
    QUEUE_NAMES.ESCALATION,
    async (job: Job<EscalationJobPayload>) => {
      const { shiftId, confirmationId, step, policyId } = job.data;

      // Only escalate if confirmation is still PENDING
      const confirmation = await prisma.shiftConfirmation.findUnique({
        where: { id: confirmationId },
        include: {
          shift: {
            include: {
              policy: { include: { team: { include: { members: { include: { user: true } } } } } },
            },
          },
          user: true,
        },
      });

      if (!confirmation || confirmation.status !== ConfirmationStatus.PENDING) return;

      const escalationRules = await prisma.escalationRule.findMany({
        where: { escalationPolicyId: policyId, stepOrder: { gte: step }, isActive: true },
        orderBy: { stepOrder: "asc" },
        take: 1,
      });

      if (escalationRules.length === 0) return;

      const rule = escalationRules[0];
      const { shift } = confirmation;

      const variables = {
        recipientName: "",
        shiftStart: shift.startsAt.toISOString(),
        shiftEnd: shift.endsAt.toISOString(),
        policyName: shift.policy.name,
        confirmationToken: confirmation.token,
        appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
      };

      if (rule.target === EscalationTarget.MANAGER) {
        const managers = shift.policy.team.members.filter((m) => m.role === "MANAGER");
        for (const manager of managers) {
          const message = await prisma.notificationMessage.create({
            data: {
              shiftId,
              recipientId: manager.userId,
              channelType: rule.channelType,
              eventType: "ESCALATION",
              templateId: "escalation-unconfirmed",
              payloadJson: { shiftId, confirmationId, step },
            },
          });

          if (rule.channelType === ChannelType.EMAIL && manager.user.email) {
            const delivery = await prisma.notificationDelivery.create({
              data: { messageId: message.id, channelType: ChannelType.EMAIL, status: DeliveryStatus.QUEUED },
            });
            await emailQueue.add("escalation-email", {
              deliveryId: delivery.id,
              messageId: message.id,
              to: manager.user.email,
              subject: `ESCALATION: Ca trực chưa được xác nhận`,
              templateId: "escalation-unconfirmed",
              variables: { ...variables, recipientName: manager.user.fullName },
            });
          }
        }
      }
    },
    { connection: createRedisConnection(), concurrency: 5 }
  );

  worker.on("failed", (job, err) => {
    console.error(`Escalation job ${job?.id} failed:`, err);
  });

  return worker;
}
