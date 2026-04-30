import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  sendTelegramMessage,
  answerCallbackQuery,
  editMessageText,
  editTelegramDeliveries,
} from "@/lib/notifications/telegram";
import { ChannelType, ConfirmationStatus, DeliveryStatus } from "@/app/generated/prisma/client";

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; username?: string; first_name?: string };
    chat: { id: number; type: string };
    text?: string;
  };
  callback_query?: {
    id: string;
    from: { id: number; username?: string; first_name?: string };
    message?: { message_id: number; chat: { id: number } };
    data?: string;
  };
}

function parseCommandPayload(text: string): { command: string; payload: string | null } | null {
  const [rawCommand, rawPayload] = text.trim().split(/\s+/, 2);
  if (!rawCommand?.startsWith("/")) return null;
  const command = rawCommand.slice(1).split("@")[0]?.toLowerCase();
  if (!command) return null;
  return { command, payload: rawPayload?.trim() || null };
}

async function linkTelegramByToken(chatId: number, linkToken: string) {
  const user = await prisma.user.findFirst({
    where: {
      telegramLinkToken: linkToken,
      telegramLinkTokenExp: { gt: new Date() },
    },
    select: { id: true, fullName: true },
  });

  if (!user) return null;

  await prisma.$transaction([
    prisma.user.updateMany({
      where: {
        telegramChatId: BigInt(chatId),
        id: { not: user.id },
      },
      data: { telegramChatId: null },
    }),
    prisma.user.update({
      where: { id: user.id },
      data: {
        telegramChatId: BigInt(chatId),
        telegramLinkToken: null,
        telegramLinkTokenExp: null,
      },
    }),
  ]);

  return user;
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (expectedSecret && secret !== expectedSecret) {
    return new NextResponse(null, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = await req.json();
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  // ── Handle callback_query (inline button press) ──────────────────────────
  if (update.callback_query) {
    const { id: cbId, data, message, from } = update.callback_query;
    if (!data || !message) {
      await answerCallbackQuery(cbId);
      return new NextResponse(null, { status: 200 });
    }

    const chatId = message.chat.id;
    const msgId = message.message_id;

    // confirm:{token} or decline:{token}
    if (data.startsWith("confirm:") || data.startsWith("decline:")) {
      const token = data.slice(data.indexOf(":") + 1);
      const action = data.startsWith("confirm:") ? "confirm" : "decline";

      const confirmation = await prisma.shiftConfirmation.findUnique({
        where: { token },
        include: {
          shift: {
            include: {
              assignee: { select: { id: true, fullName: true, telegramChatId: true } },
              policy: { select: { name: true, teamId: true } },
            },
          },
        },
      });

      if (!confirmation || confirmation.status !== ConfirmationStatus.PENDING) {
        await answerCallbackQuery(cbId, "Ca trực này đã được xử lý rồi.", true);
        return new NextResponse(null, { status: 200 });
      }

      if (new Date() > confirmation.dueAt) {
        await prisma.shiftConfirmation.update({
          where: { token },
          data: { status: ConfirmationStatus.EXPIRED },
        });
        await answerCallbackQuery(cbId, "Xác nhận đã hết hạn.", true);
        return new NextResponse(null, { status: 200 });
      }

      const newStatus = action === "confirm" ? ConfirmationStatus.CONFIRMED : ConfirmationStatus.DECLINED;
      await prisma.shiftConfirmation.update({
        where: { token },
        data: { status: newStatus, respondedAt: new Date() },
      });

      const fmtVN = (d: Date) => d.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
      const icon = action === "confirm" ? "✅" : "❌";
      const label = action === "confirm" ? "Đã xác nhận" : "Đã từ chối";
      const updatedText = [
        `${icon} <b>${label} ca trực</b>`,
        ``,
        `Ca: <b>${confirmation.shift.policy.name}</b>`,
        `Bắt đầu: ${fmtVN(confirmation.shift.startsAt)}`,
        `Kết thúc: ${fmtVN(confirmation.shift.endsAt)}`,
        ``,
        `Người thực hiện: ${from.first_name ?? ""}`,
      ].join("\n");

      // Edit the clicked message (remove keyboard, show new status)
      await editMessageText(chatId, msgId, updatedText, "HTML", { inline_keyboard: [] });
      await answerCallbackQuery(cbId, `${icon} ${label} thành công!`);

      // Edit all OTHER personal messages for this shift (other reminder messages sent to same chat)
      const otherDeliveries = await prisma.notificationDelivery.findMany({
        where: {
          channelType: ChannelType.TELEGRAM,
          status: DeliveryStatus.SENT,
          externalId: { startsWith: `${chatId}|`, not: `${chatId}|${msgId}` },
          message: { shiftId: confirmation.shiftId },
        },
        select: { externalId: true },
      });
      if (otherDeliveries.length > 0) {
        await editTelegramDeliveries(otherDeliveries, updatedText).catch(() => {});
      }

      // Notify team channels (fire-and-forget)
      import("@/lib/notifications/notify-channel").then(({ notifyTeamChannels }) =>
        notifyTeamChannels({
          teamId: confirmation.shift.policy.teamId,
          eventType: newStatus === ConfirmationStatus.CONFIRMED ? "SHIFT_CONFIRMED" : "SHIFT_DECLINED",
          templateId: newStatus === ConfirmationStatus.CONFIRMED ? "shift-confirmed" : "shift-declined",
          recipientId: confirmation.userId,
          variables: {
            recipientName: confirmation.shift.assignee.fullName,
            policyName: confirmation.shift.policy.name,
            shiftStart: confirmation.shift.startsAt.toISOString(),
            shiftEnd: confirmation.shift.endsAt.toISOString(),
            appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
          },
        })
      ).catch(() => {});

      return new NextResponse(null, { status: 200 });
    }

    // ack:{alertId}
    if (data.startsWith("ack:")) {
      const alertId = data.slice(4);

      const alert = await prisma.alert.findUnique({ where: { id: alertId } });
      if (!alert || alert.status !== "FIRING") {
        await answerCallbackQuery(cbId, "Cảnh báo này đã được xử lý rồi.", true);
        return new NextResponse(null, { status: 200 });
      }

      const telegramUser = await prisma.user.findFirst({
        where: { telegramChatId: BigInt(chatId) },
        select: { id: true, fullName: true },
      });

      await prisma.alert.update({
        where: { id: alertId },
        data: {
          status: "ACKNOWLEDGED",
          ...(telegramUser ? { acknowledgedById: telegramUser.id } : {}),
        },
      });

      const ackLabel = telegramUser?.fullName ?? from.first_name ?? "ai đó";
      const updatedText = [
        `👍 <b>Cảnh báo đã được nhận</b>`,
        ``,
        `<b>${alert.title}</b>`,
        ...(alert.message ? [`${alert.message}`, ``] : []),
        `Nhận bởi: <b>${ackLabel}</b>`,
      ].join("\n");

      await editMessageText(chatId, msgId, updatedText, "HTML", { inline_keyboard: [] });
      await answerCallbackQuery(cbId, `👍 Đã nhận bởi ${ackLabel}`);
      return new NextResponse(null, { status: 200 });
    }

    await answerCallbackQuery(cbId);
    return new NextResponse(null, { status: 200 });
  }

  // ── Handle regular message ────────────────────────────────────────────────
  const message = update.message;
  if (!message?.text || !message.from) {
    return new NextResponse(null, { status: 200 });
  }

  const chatId = message.chat.id;
  const text = message.text.trim();

  const parsedCommand = parseCommandPayload(text);

  if (parsedCommand && (parsedCommand.command === "start" || parsedCommand.command === "link")) {
    if (parsedCommand.payload) {
      const linkedUser = await linkTelegramByToken(chatId, parsedCommand.payload);
      if (linkedUser) {
        await sendTelegramMessage(
          chatId.toString(),
          `✅ Tài khoản <b>${linkedUser.fullName}</b> đã được liên kết thành công!\n\nBạn sẽ nhận thông báo ca trực tại đây.\n\n<b>Các lệnh hỗ trợ:</b>\n/oncall — Xem ca trực đang diễn ra\n/status — Trạng thái ca trực của bạn`,
          "HTML"
        );
      } else {
        await sendTelegramMessage(
          chatId.toString(),
          `❌ Mã liên kết không hợp lệ hoặc đã hết hạn (10 phút).\n\nVui lòng vào ứng dụng → Hồ sơ → Kết nối Telegram để tạo mã mới.\n\nSau đó gửi lại theo cú pháp:\n<code>/link &lt;ma_lien_ket&gt;</code>`,
          "HTML"
        );
      }
    } else {
      const linkedUser = await prisma.user.findFirst({
        where: { telegramChatId: BigInt(chatId) },
        select: { fullName: true },
      });

      if (linkedUser) {
        await sendTelegramMessage(
          chatId.toString(),
          `✅ Chat này đã liên kết với tài khoản <b>${linkedUser.fullName}</b>.\n\nBạn có thể dùng:\n/oncall — Xem ca trực đang diễn ra\n/status — Trạng thái ca trực hiện tại`,
          "HTML"
        );
      } else {
        await sendTelegramMessage(
          chatId.toString(),
          `👋 Xin chào! Để liên kết Telegram, hãy vào ứng dụng → Hồ sơ → Kết nối Telegram.\n\nNếu Telegram chỉ gửi lệnh <code>/start</code> mà không kèm mã, bạn hãy copy mã trong ứng dụng và gửi:\n<code>/link &lt;ma_lien_ket&gt;</code>`,
          "HTML"
        );
      }
    }
  }

  if (parsedCommand && (parsedCommand.command === "oncall" || parsedCommand.command === "status")) {
    const now = new Date();
    const activeShifts = await prisma.shift.findMany({
      where: {
        startsAt: { lte: now },
        endsAt: { gte: now },
        status: { in: ["PUBLISHED", "ACTIVE"] },
      },
      include: {
        assignee: { select: { fullName: true } },
        policy: { select: { name: true, team: { select: { name: true } } } },
      },
      take: 5,
    });

    if (activeShifts.length === 0) {
      await sendTelegramMessage(chatId.toString(), "ℹ️ Hiện không có ca trực nào đang diễn ra.");
    } else {
      const lines = [
        `🟢 <b>Đang trực:</b>`,
        ``,
        ...activeShifts.map((s) =>
          `• <b>${s.assignee.fullName}</b> — ${s.policy?.team?.name ?? ""} / ${s.policy?.name ?? ""}`
        ),
      ];
      await sendTelegramMessage(chatId.toString(), lines.join("\n"), "HTML");
    }
  }

  return new NextResponse(null, { status: 200 });
}
