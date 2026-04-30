import { NextRequest, NextResponse } from "next/server";
import { TelegramUpdate } from "@/lib/notifications/telegram";
import { processTelegramUpdate } from "@/lib/telegram/process-update";

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

  await processTelegramUpdate(update);
  return new NextResponse(null, { status: 200 });
}
