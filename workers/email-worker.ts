import { Worker, Job } from "bullmq";
import { Resend } from "resend";
import { createRedisConnection } from "@/lib/redis";
import { QUEUE_NAMES } from "@/lib/queue/queues";
import type { EmailJobPayload } from "@/lib/queue/jobs";
import { prisma } from "@/lib/prisma";
import { DeliveryStatus } from "@/app/generated/prisma/client";

const resend = new Resend(process.env.RESEND_API_KEY);

function renderEmailTemplate(templateId: string, vars: Record<string, string>): { subject: string; html: string } {
  // Templates expand here; currently returning a simple HTML version
  const confirmUrl = `${vars.appUrl}/confirm/${vars.confirmationToken}`;
  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:auto">
      <h2>Nhắc nhở ca trực</h2>
      <p>Xin chào ${vars.recipientName},</p>
      <p>Bạn có ca trực <strong>${vars.policyName}</strong>:</p>
      <ul>
        <li>Bắt đầu: ${new Date(vars.shiftStart).toLocaleString("vi-VN")}</li>
        <li>Kết thúc: ${new Date(vars.shiftEnd).toLocaleString("vi-VN")}</li>
      </ul>
      <p>Vui lòng xác nhận ca trực của bạn:</p>
      <a href="${confirmUrl}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;border-radius:8px;text-decoration:none">
        Xác nhận ca trực
      </a>
    </div>
  `;
  return { subject: vars.subject ?? "Nhắc nhở ca trực", html };
}

export function startEmailWorker() {
  const worker = new Worker<EmailJobPayload>(
    QUEUE_NAMES.EMAIL,
    async (job: Job<EmailJobPayload>) => {
      const { deliveryId, to, subject, templateId, variables } = job.data;

      await prisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: {
          status: DeliveryStatus.RETRYING,
          attemptCount: { increment: 1 },
          lastAttemptAt: new Date(),
        },
      });

      try {
        const { html } = renderEmailTemplate(templateId, { ...variables, subject });

        const result = await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL ?? "oncall@example.com",
          to,
          subject,
          html,
        });

        await prisma.notificationDelivery.update({
          where: { id: deliveryId },
          data: {
            status: DeliveryStatus.SENT,
            externalId: result.data?.id ?? null,
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
    { connection: createRedisConnection(), concurrency: 5 }
  );

  worker.on("failed", (job, err) => {
    console.error(`Email job ${job?.id} failed:`, err);
  });

  return worker;
}
