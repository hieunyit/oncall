import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, notFound, badRequest, handleError } from "@/lib/api-response";
import { ShiftStatus, ChannelType, DeliveryStatus } from "@/app/generated/prisma/client";
import { emailQueue, telegramQueue, teamsQueue } from "@/lib/queue/queues";

// Public endpoint — no auth, secured by opaque token
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    const integration = await prisma.alertIntegration.findUnique({
      where: { token },
      include: { team: { select: { id: true, name: true } } },
    });
    if (!integration || !integration.isActive) return notFound("Integration not found");

    const body = await req.json().catch(() => null);
    if (!body) return badRequest("Invalid JSON");

    const title = String(body.title ?? body.alertname ?? body.labels?.alertname ?? "Alert");
    const message = String(body.message ?? body.annotations?.summary ?? body.description ?? "");
    const severity = String(body.severity ?? body.labels?.severity ?? "");
    const sourceRef = String(body.id ?? body.fingerprint ?? "").slice(0, 200) || null;
    const resolving = body.status === "resolved" || body.resolved === true;

    // If it's a resolve event for an existing alert, resolve it
    if (resolving && sourceRef) {
      const existing = await prisma.alert.findFirst({
        where: { integrationId: integration.id, sourceRef, status: { in: ["FIRING", "ACKNOWLEDGED"] } },
      });
      if (existing) {
        await prisma.alert.update({
          where: { id: existing.id },
          data: { status: "RESOLVED", resolvedAt: new Date() },
        });
        return ok({ id: existing.id, status: "RESOLVED" });
      }
    }

    const alert = await prisma.alert.create({
      data: {
        integrationId: integration.id,
        title,
        message: message || null,
        severity: severity || null,
        sourceRef,
        payloadJson: body,
        status: "FIRING",
      },
    });

    // Notify current on-call person
    const now = new Date();
    const activeShifts = await prisma.shift.findMany({
      where: {
        startsAt: { lte: now },
        endsAt: { gte: now },
        status: { in: [ShiftStatus.PUBLISHED, ShiftStatus.ACTIVE] },
        policy: { teamId: integration.teamId },
        overrideForShiftId: null,
      },
      include: {
        assignee: { select: { id: true, fullName: true, email: true, telegramChatId: true, teamsConversationId: true } },
        overrides: {
          where: { startsAt: { lte: now }, endsAt: { gte: now }, status: { in: [ShiftStatus.PUBLISHED, ShiftStatus.ACTIVE] } },
          include: { assignee: { select: { id: true, fullName: true, email: true, telegramChatId: true, teamsConversationId: true } } },
          take: 1,
        },
      },
      take: 1,
    });

    for (const shift of activeShifts) {
      const oncallUser = shift.overrides[0]?.assignee ?? shift.assignee;
      const vars = {
        recipientName: oncallUser.fullName,
        alertTitle: title,
        alertMessage: message,
        alertSeverity: severity,
        teamName: integration.team.name,
        integrationName: integration.name,
        appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
      };

      const notifMsg = await prisma.notificationMessage.create({
        data: {
          recipientId: oncallUser.id,
          channelType: ChannelType.EMAIL,
          eventType: "ALERT_FIRING",
          templateId: "alert-firing",
          payloadJson: { alertId: alert.id, ...vars },
        },
      });

      if (oncallUser.email) {
        const delivery = await prisma.notificationDelivery.create({
          data: { messageId: notifMsg.id, channelType: ChannelType.EMAIL, status: DeliveryStatus.QUEUED },
        });
        await emailQueue.add("alert-firing", {
          deliveryId: delivery.id,
          messageId: notifMsg.id,
          to: oncallUser.email,
          subject: `🔴 ALERT: ${title}`,
          templateId: "alert-firing",
          variables: vars,
        });
      }

      if (oncallUser.telegramChatId) {
        const tgMsg = await prisma.notificationMessage.create({
          data: {
            recipientId: oncallUser.id,
            channelType: ChannelType.TELEGRAM,
            eventType: "ALERT_FIRING",
            templateId: "alert-firing",
            payloadJson: { alertId: alert.id, ...vars },
          },
        });
        const tgDelivery = await prisma.notificationDelivery.create({
          data: { messageId: tgMsg.id, channelType: ChannelType.TELEGRAM, status: DeliveryStatus.QUEUED },
        });
        await telegramQueue.add("alert-firing", {
          deliveryId: tgDelivery.id,
          messageId: tgMsg.id,
          chatId: oncallUser.telegramChatId.toString(),
          templateId: "alert-firing",
          variables: { ...vars, alertId: alert.id },
        });
      }

      // Notify team Telegram channels
      const tgChannels = await prisma.teamNotificationChannel.findMany({
        where: { teamId: integration.teamId, type: ChannelType.TELEGRAM },
      });
      for (const channel of tgChannels) {
        const cfg = channel.configJson as Record<string, string>;
        const chatId = cfg.chatId;
        if (!chatId) continue;
        const tgMsg = await prisma.notificationMessage.create({
          data: {
            recipientId: oncallUser.id,
            channelType: ChannelType.TELEGRAM,
            eventType: "ALERT_FIRING",
            templateId: "alert-firing",
            payloadJson: { alertId: alert.id, channelId: channel.id, ...vars },
          },
        });
        const tgDelivery = await prisma.notificationDelivery.create({
          data: { messageId: tgMsg.id, channelType: ChannelType.TELEGRAM, status: DeliveryStatus.QUEUED },
        });
        await telegramQueue.add("alert-firing-channel", {
          deliveryId: tgDelivery.id,
          messageId: tgMsg.id,
          chatId,
          templateId: "alert-firing",
          variables: vars,
        });
      }
    }

    return ok({ id: alert.id, status: "FIRING" });
  } catch (error) {
    return handleError(error);
  }
}
