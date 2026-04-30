import { ChannelType, DeliveryStatus } from "@/app/generated/prisma/client";
import { sendTelegramMessage } from "@/lib/notifications/telegram";
import { prisma } from "@/lib/prisma";

type ShiftLite = {
  assigneeId: string;
  startsAt: Date;
  endsAt: Date;
};

export type NotifyAssigneesSummary = {
  policyName: string;
  reason: "published" | "rescheduled";
  totalShifts: number;
  uniqueAssignees: number;
  attempted: number;
  sent: number;
  failed: number;
  skippedNoTelegram: number;
  skippedNoUser: number;
};

function formatVNDate(date: Date): string {
  return date.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
}

function buildScheduleAssignedText(input: {
  fullName: string;
  policyName: string;
  shifts: ShiftLite[];
  total: number;
  appUrl: string;
  reason: "published" | "rescheduled";
}) {
  const reasonLabel =
    input.reason === "published" ? "Lịch trực mới đã được phân công" : "Lịch trực của bạn đã được cập nhật";

  const lines = [
    `📌 <b>${reasonLabel}</b>`,
    ``,
    `Xin chào <b>${input.fullName}</b>,`,
    `Chính sách: <b>${input.policyName}</b>`,
    `Tổng số ca được cập nhật: <b>${input.total}</b>`,
    ``,
    `Ca gần nhất của bạn:`,
    ...input.shifts.map(
      (shift, index) =>
        `${index + 1}. ${formatVNDate(shift.startsAt)} → ${formatVNDate(shift.endsAt)}`
    ),
  ];

  if (input.total > input.shifts.length) {
    lines.push(``, `...và ${input.total - input.shifts.length} ca khác.`);
  }

  if (input.appUrl) {
    lines.push(``, `<a href="${input.appUrl}/schedule">Xem lịch trực chi tiết</a>`);
  }

  return lines.join("\n");
}

export async function notifyAssigneesScheduleUpdated(input: {
  policyName: string;
  shifts: ShiftLite[];
  reason: "published" | "rescheduled";
}) {
  const emptySummary: NotifyAssigneesSummary = {
    policyName: input.policyName,
    reason: input.reason,
    totalShifts: input.shifts.length,
    uniqueAssignees: 0,
    attempted: 0,
    sent: 0,
    failed: 0,
    skippedNoTelegram: 0,
    skippedNoUser: 0,
  };
  if (input.shifts.length === 0) return emptySummary;

  const grouped = new Map<string, ShiftLite[]>();
  for (const shift of input.shifts) {
    const list = grouped.get(shift.assigneeId) ?? [];
    list.push(shift);
    grouped.set(shift.assigneeId, list);
  }

  const assigneeIds = [...grouped.keys()];
  const users = await prisma.user.findMany({
    where: {
      id: { in: assigneeIds },
      isActive: true,
    },
    select: {
      id: true,
      fullName: true,
      telegramChatId: true,
    },
  });

  const userMap = new Map(users.map((user) => [user.id, user]));
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  let attempted = 0;
  let sent = 0;
  let failed = 0;
  let skippedNoTelegram = 0;
  let skippedNoUser = 0;

  console.info("[notify-assignees] start", {
    policyName: input.policyName,
    reason: input.reason,
    totalShifts: input.shifts.length,
    uniqueAssignees: assigneeIds.length,
  });

  for (const assigneeId of assigneeIds) {
    const user = userMap.get(assigneeId);
    if (!user) {
      skippedNoUser += 1;
      console.warn("[notify-assignees] skipped: active user not found", {
        assigneeId,
        policyName: input.policyName,
      });
      continue;
    }
    const userShifts = (grouped.get(user.id) ?? []).sort(
      (a, b) => a.startsAt.getTime() - b.startsAt.getTime()
    );
    if (userShifts.length === 0) continue;
    if (!user.telegramChatId) {
      skippedNoTelegram += 1;
      console.info("[notify-assignees] skipped: user has no telegramChatId", {
        assigneeId: user.id,
        fullName: user.fullName,
      });
      continue;
    }

    attempted += 1;

    const text = buildScheduleAssignedText({
      fullName: user.fullName,
      policyName: input.policyName,
      shifts: userShifts.slice(0, 3),
      total: userShifts.length,
      appUrl,
      reason: input.reason,
    });

    const message = await prisma.notificationMessage.create({
      data: {
        recipientId: user.id,
        channelType: ChannelType.TELEGRAM,
        eventType: "SCHEDULE_ASSIGNED",
        templateId: "schedule-assigned",
        payloadJson: {
          policyName: input.policyName,
          total: userShifts.length,
          reason: input.reason,
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
        failed += 1;
        await prisma.notificationDelivery.update({
          where: { id: delivery.id },
          data: {
            status: DeliveryStatus.FAILED,
            attemptCount: { increment: 1 },
            lastAttemptAt: new Date(),
            errorJson: { message: result.description ?? "Telegram API error" },
          },
        });
        console.warn("[notify-assignees] send failed", {
          assigneeId: user.id,
          fullName: user.fullName,
          error: result.description ?? "Telegram API error",
        });
        continue;
      }

      sent += 1;
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
    } catch (error) {
      failed += 1;
      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: DeliveryStatus.FAILED,
          attemptCount: { increment: 1 },
          lastAttemptAt: new Date(),
          errorJson: { message: (error as Error).message },
        },
      });
      console.error("[notify-assignees] send threw exception", {
        assigneeId: user.id,
        fullName: user.fullName,
        error: (error as Error).message,
      });
    }
  }

  const summary: NotifyAssigneesSummary = {
    policyName: input.policyName,
    reason: input.reason,
    totalShifts: input.shifts.length,
    uniqueAssignees: assigneeIds.length,
    attempted,
    sent,
    failed,
    skippedNoTelegram,
    skippedNoUser,
  };

  console.info("[notify-assignees] done", summary);
  return summary;
}
