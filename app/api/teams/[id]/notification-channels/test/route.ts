import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser, requireTeamRole, isNextResponse } from "@/lib/rbac";
import { ok, badRequest, notFound, unauthorized, handleError } from "@/lib/api-response";
import { TeamRole } from "@/app/generated/prisma/client";
import { sendTeamsWebhook, buildTeamsAdaptiveCard } from "@/lib/notifications/teams";
import { sendTelegramMessage } from "@/lib/notifications/telegram";

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

    return badRequest("Loại kênh này chưa hỗ trợ test");
  } catch (error) {
    return handleError(error);
  }
}
