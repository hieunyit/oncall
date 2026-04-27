import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendTelegramMessage, answerCallbackQuery, editMessageText } from "@/lib/notifications/telegram";
import { ConfirmationStatus } from "@/app/generated/prisma/client";

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

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  if (secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
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

      await editMessageText(chatId, msgId, updatedText);
      await answerCallbackQuery(cbId, `${icon} ${label} thành công!`);

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

      // Find the user by their Telegram chatId
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

      await editMessageText(chatId, msgId, updatedText);
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

  if (text.startsWith("/start")) {
    const parts = text.split(" ");
    const linkToken = parts[1];

    if (linkToken) {
      const user = await prisma.user.findFirst({ where: { id: linkToken } });

      if (user) {
        await prisma.user.update({
          where: { id: user.id },
          data: { telegramChatId: BigInt(chatId) },
        });
        await sendTelegramMessage(
          chatId.toString(),
          `✅ Tài khoản <b>${user.fullName}</b> đã được liên kết thành công!\n\nBạn sẽ nhận thông báo ca trực tại đây.`,
          "HTML"
        );
      } else {
        await sendTelegramMessage(
          chatId.toString(),
          `❌ Liên kết không hợp lệ hoặc đã hết hạn. Vui lòng thử lại từ ứng dụng.`
        );
      }
    } else {
      await sendTelegramMessage(
        chatId.toString(),
        `👋 Xin chào! Tôi là bot On-Call Manager.\n\nĐể liên kết tài khoản, hãy truy cập ứng dụng và nhấn "Kết nối Telegram".`
      );
    }
  }

  if (text === "/oncall" || text === "/status") {
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
