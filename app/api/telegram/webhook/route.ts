import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendTelegramMessage } from "@/lib/notifications/telegram";

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; username?: string; first_name?: string };
    chat: { id: number; type: string };
    text?: string;
  };
}

export async function POST(req: NextRequest) {
  // Validate Telegram webhook secret
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

  const message = update.message;
  if (!message?.text || !message.from) {
    return new NextResponse(null, { status: 200 });
  }

  const chatId = message.chat.id;
  const text = message.text.trim();

  // /start command — onboarding: link Telegram chat to user account
  if (text.startsWith("/start")) {
    const parts = text.split(" ");
    const linkToken = parts[1]; // /start <token>

    if (linkToken) {
      // Deep link token is the user's UUID id — hard to guess, no extra DB column needed
      const user = await prisma.user.findFirst({
        where: { id: linkToken },
      });

      if (user) {
        await prisma.user.update({
          where: { id: user.id },
          data: { telegramChatId: BigInt(chatId) },
        });
        await sendTelegramMessage(
          chatId.toString(),
          `✅ Tài khoản của bạn đã được liên kết thành công!\n\nBạn sẽ nhận thông báo ca trực tại đây.`
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

  return new NextResponse(null, { status: 200 });
}
