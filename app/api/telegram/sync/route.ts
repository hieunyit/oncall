import { badRequest, handleError, ok, unauthorized } from "@/lib/api-response";
import {
  deleteTelegramWebhook,
  getTelegramUpdates,
  TelegramUpdate,
} from "@/lib/notifications/telegram";
import { getSessionUser } from "@/lib/rbac";
import { processTelegramUpdate } from "@/lib/telegram/process-update";

function isLikelyPlaceholderToken(token: string) {
  const lower = token.toLowerCase();
  return (
    token.length < 20 ||
    !token.includes(":") ||
    lower.includes("your-telegram-bot-token") ||
    lower.includes("change-me")
  );
}

function getValidBotToken() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token || isLikelyPlaceholderToken(token)) return null;
  return token;
}

export async function POST() {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    if (!getValidBotToken()) {
      return badRequest("TELEGRAM_BOT_TOKEN chưa cấu hình hợp lệ.");
    }

    // Switch bot to polling mode: getUpdates cannot run while webhook is active.
    const deleteWebhookResult = await deleteTelegramWebhook(false);
    if (!deleteWebhookResult.ok) {
      return badRequest(
        `Không thể chuyển sang polling mode: ${deleteWebhookResult.description ?? "Unknown error"}`,
        deleteWebhookResult
      );
    }

    const pulled = await getTelegramUpdates({
      offset: -20,
      limit: 20,
      timeout: 0,
      allowedUpdates: ["message", "callback_query"],
    });
    if (!pulled.ok) {
      return badRequest(
        `Lấy update Telegram thất bại: ${pulled.description ?? "Unknown error"}`,
        pulled
      );
    }

    const updates = Array.isArray(pulled.result) ? (pulled.result as TelegramUpdate[]) : [];
    const linkUpdates = updates.filter((update) => {
      const text = update.message?.text?.trim().toLowerCase();
      return !!text && (text.startsWith("/start") || text.startsWith("/link"));
    });
    let maxUpdateId: number | null = null;

    for (const update of updates) {
      if (typeof update.update_id === "number") {
        maxUpdateId = maxUpdateId === null ? update.update_id : Math.max(maxUpdateId, update.update_id);
      }
    }

    for (const update of linkUpdates) {
      await processTelegramUpdate(update);
    }

    let acknowledged = false;
    if (maxUpdateId !== null) {
      const ack = await getTelegramUpdates({
        offset: maxUpdateId + 1,
        limit: 1,
        timeout: 0,
      });
      acknowledged = !!ack.ok;
    }

    return ok({
      mode: "polling",
      pulled: updates.length,
      processed: linkUpdates.length,
      maxUpdateId,
      acknowledged,
    });
  } catch (error) {
    return handleError(error);
  }
}
