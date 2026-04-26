import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser, requireTeamRole, isNextResponse } from "@/lib/rbac";
import { ok, badRequest, notFound, unauthorized, handleError } from "@/lib/api-response";
import { TeamRole } from "@/app/generated/prisma/client";
import { sendTeamsWebhook, buildTeamsAdaptiveCard } from "@/lib/notifications/teams";
import { sendTelegramMessage } from "@/lib/notifications/telegram";
import { Resend } from "resend";

const TestSchema = z.object({ channelId: z.string().uuid() });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const { id: teamId } = await params;
    const result = await requireTeamRole(teamId, TeamRole.MANAGER);
    if (isNextResponse(result)) return result;

    const body = await req.json();
    const { channelId } = TestSchema.parse(body);

    const channel = await prisma.teamNotificationChannel.findUnique({
      where: { id: channelId },
    });
    if (!channel || channel.teamId !== teamId) return notFound("Channel not found");

    const cfg = channel.configJson as Record<string, string>;

    if (channel.type === "TEAMS") {
      const webhookUrl = cfg.webhookUrl;
      if (!webhookUrl) return badRequest("Webhook URL chưa được cấu hình");

      const card = buildTeamsAdaptiveCard("shift-reminder", {
        recipientName: actor.fullName ?? "Test User",
        policyName: "Test Policy",
        shiftStart: new Date().toISOString(),
        shiftEnd: new Date(Date.now() + 8 * 3600_000).toISOString(),
        confirmationToken: "test-token",
        appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
      });
      await sendTeamsWebhook(webhookUrl, card);
      return ok({ message: "Đã gửi tin nhắn test đến Teams" });
    }

    if (channel.type === "TELEGRAM") {
      const chatId = cfg.chatId;
      if (!chatId) return badRequest("Chat ID chưa được cấu hình");

      const text = [
        "✅ <b>Test thông báo từ On-Call Manager</b>",
        "",
        `Kênh <b>${channel.name}</b> đã được cấu hình thành công!`,
        `Gửi bởi: ${actor.fullName}`,
      ].join("\n");

      const result = await sendTelegramMessage(chatId, text, "HTML");
      if (!result.ok) throw new Error(result.description ?? "Telegram API error");
      return ok({ message: "Đã gửi tin nhắn test đến Telegram" });
    }

    if (channel.type === "EMAIL") {
      const address = cfg.address;
      if (!address) return badRequest("Địa chỉ email chưa được cấu hình");

      const resend = new Resend(process.env.RESEND_API_KEY);
      const { error: sendError } = await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL ?? "oncall@example.com",
        to: address,
        subject: "Test thông báo từ On-Call Manager",
        html: `<div style="font-family:sans-serif;max-width:500px;margin:auto;padding:24px">
          <h2 style="color:#1d4ed8">Test thông báo</h2>
          <p>Kênh <strong>${channel.name}</strong> đã được cấu hình thành công!</p>
          <p style="color:#6b7280;font-size:14px">Gửi bởi: ${actor.fullName}</p>
        </div>`,
      });
      if (sendError) throw new Error(sendError.message);
      return ok({ message: `Đã gửi email test đến ${address}` });
    }

    return badRequest("Loại kênh này chưa hỗ trợ test");
  } catch (error) {
    return handleError(error);
  }
}
