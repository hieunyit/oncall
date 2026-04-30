import { ChannelType, DeliveryStatus, TeamRole } from "@/app/generated/prisma/client";
import { sendTelegramMessage } from "@/lib/notifications/telegram";
import { prisma } from "@/lib/prisma";

export type NotifyMemberAddedSummary = {
  userId: string;
  teamId: string;
  sent: boolean;
  status: "sent" | "failed" | "skipped_no_user" | "skipped_no_telegram";
  error?: string;
};

function roleLabel(role: TeamRole): string {
  return role === TeamRole.MANAGER ? "Quản lý" : "Thành viên";
}

function buildTeamAddedText(input: {
  fullName: string;
  teamName: string;
  role: TeamRole;
  actorName: string;
  appUrl: string;
}) {
  const lines = [
    "✅ <b>Bạn vừa được thêm vào nhóm trực</b>",
    "",
    `Xin chào <b>${input.fullName}</b>,`,
    `Nhóm: <b>${input.teamName}</b>`,
    `Vai trò: <b>${roleLabel(input.role)}</b>`,
    `Người thêm: <b>${input.actorName}</b>`,
  ];

  if (input.appUrl) {
    lines.push("", `<a href="${input.appUrl}/teams">Mở danh sách nhóm</a>`);
  }

  return lines.join("\n");
}

export async function notifyUserAddedToTeam(input: {
  userId: string;
  teamId: string;
  teamName: string;
  role: TeamRole;
  actorName: string;
}): Promise<NotifyMemberAddedSummary> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, fullName: true, telegramChatId: true, isActive: true },
  });

  if (!user || !user.isActive) {
    const summary: NotifyMemberAddedSummary = {
      userId: input.userId,
      teamId: input.teamId,
      sent: false,
      status: "skipped_no_user",
    };
    console.warn("[notify-team-member] skipped: user missing or inactive", summary);
    return summary;
  }

  if (!user.telegramChatId) {
    const summary: NotifyMemberAddedSummary = {
      userId: input.userId,
      teamId: input.teamId,
      sent: false,
      status: "skipped_no_telegram",
    };
    console.info("[notify-team-member] skipped: user has no telegramChatId", summary);
    return summary;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const text = buildTeamAddedText({
    fullName: user.fullName,
    teamName: input.teamName,
    role: input.role,
    actorName: input.actorName,
    appUrl,
  });

  const message = await prisma.notificationMessage.create({
    data: {
      recipientId: user.id,
      channelType: ChannelType.TELEGRAM,
      eventType: "TEAM_MEMBER_ADDED",
      templateId: "team-member-added",
      payloadJson: {
        teamId: input.teamId,
        teamName: input.teamName,
        role: input.role,
        actorName: input.actorName,
      },
    },
  });

  const delivery = await prisma.notificationDelivery.create({
    data: {
      messageId: message.id,
      channelType: ChannelType.TELEGRAM,
      status: DeliveryStatus.QUEUED,
    },
  });

  try {
    const result = await sendTelegramMessage(user.telegramChatId.toString(), text, "HTML");
    if (!result.ok) {
      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: DeliveryStatus.FAILED,
          attemptCount: { increment: 1 },
          lastAttemptAt: new Date(),
          errorJson: { message: result.description ?? "Telegram API error" },
        },
      });

      const summary: NotifyMemberAddedSummary = {
        userId: input.userId,
        teamId: input.teamId,
        sent: false,
        status: "failed",
        error: result.description ?? "Telegram API error",
      };
      console.warn("[notify-team-member] send failed", summary);
      return summary;
    }

    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: DeliveryStatus.SENT,
        attemptCount: { increment: 1 },
        lastAttemptAt: new Date(),
        externalId:
          result.result?.message_id != null
            ? `${user.telegramChatId.toString()}|${result.result.message_id}`
            : null,
      },
    });

    const summary: NotifyMemberAddedSummary = {
      userId: input.userId,
      teamId: input.teamId,
      sent: true,
      status: "sent",
    };
    console.info("[notify-team-member] sent", summary);
    return summary;
  } catch (error) {
    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: DeliveryStatus.FAILED,
        attemptCount: { increment: 1 },
        lastAttemptAt: new Date(),
        errorJson: { message: (error as Error).message },
      },
    });

    const summary: NotifyMemberAddedSummary = {
      userId: input.userId,
      teamId: input.teamId,
      sent: false,
      status: "failed",
      error: (error as Error).message,
    };
    console.error("[notify-team-member] send threw exception", summary);
    return summary;
  }
}
