import { SystemRole } from "@/app/generated/prisma/client";
import { badRequest, forbidden, handleError, ok, unauthorized } from "@/lib/api-response";
import {
  deleteTelegramWebhook,
  getTelegramWebhookInfo,
  setTelegramCommands,
} from "@/lib/notifications/telegram";
import { getSessionUser } from "@/lib/rbac";
import { TELEGRAM_BOT_COMMANDS } from "@/lib/telegram/bot-config";

function isLikelyPlaceholderToken(token: string) {
  const lower = token.toLowerCase();
  return (
    token.length < 20 ||
    !token.includes(":") ||
    lower.includes("your-telegram-bot-token") ||
    lower.includes("change-me")
  );
}

async function requireAdmin() {
  const actor = await getSessionUser();
  if (!actor) return { error: unauthorized(), actor: null };
  if (actor.systemRole !== SystemRole.ADMIN) return { error: forbidden("Admin only"), actor: null };
  return { error: null, actor };
}

function readTelegramToken() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token || isLikelyPlaceholderToken(token)) return null;
  return token;
}

export async function POST() {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const token = readTelegramToken();
    if (!token) {
      return badRequest("TELEGRAM_BOT_TOKEN chưa cấu hình hợp lệ.");
    }

    const deleted = await deleteTelegramWebhook(false);
    if (!deleted.ok) {
      return badRequest(
        `Không thể chuyển sang polling mode: ${deleted.description ?? "Unknown error"}`,
        deleted
      );
    }

    const commands = await setTelegramCommands([...TELEGRAM_BOT_COMMANDS]);
    if (!commands.ok) {
      return badRequest(
        `Cài command Telegram thất bại: ${commands.description ?? "Unknown error"}`,
        commands
      );
    }

    const info = await getTelegramWebhookInfo().catch(() => null);
    const webhookStillSet = !!info?.ok && !!info.result?.url;

    return ok({
      mode: "polling",
      deleteWebhook: deleted,
      commands,
      webhookInfo: info,
      warning: webhookStillSet ? "Webhook URL vẫn còn cấu hình trên Telegram. Hãy thử lại sau vài giây." : null,
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const token = readTelegramToken();
    if (!token) {
      return badRequest("TELEGRAM_BOT_TOKEN chưa cấu hình hợp lệ.");
    }

    const info = await getTelegramWebhookInfo();
    if (!info.ok) {
      return badRequest(
        `Không lấy được trạng thái webhook: ${info.description ?? "Unknown error"}`,
        info
      );
    }

    const mode = info.result?.url ? "webhook" : "polling";
    return ok({
      mode,
      webhookInfo: info,
      usingGetUpdates: !info.result?.url,
      recommendation: info.result?.url
        ? "Webhook đang bật. Nhấn 'Dùng getUpdates (polling)' để chuyển sang polling."
        : "Đang dùng getUpdates (polling).",
    });
  } catch (error) {
    return handleError(error);
  }
}
