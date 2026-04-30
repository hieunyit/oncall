import { SystemRole } from "@/app/generated/prisma/client";
import { badRequest, forbidden, handleError, ok, unauthorized } from "@/lib/api-response";
import {
  deleteTelegramWebhook,
  getTelegramWebhookInfo,
  setTelegramWebhook,
} from "@/lib/notifications/telegram";
import { getSessionUser } from "@/lib/rbac";

type TelegramSetupMode = "polling" | "webhook";

function normalizeBaseUrl(input: string) {
  return input.trim().replace(/\/+$/, "");
}

function isLikelyPlaceholderToken(token: string) {
  const lower = token.toLowerCase();
  return (
    token.length < 20 ||
    !token.includes(":") ||
    lower.includes("your-telegram-bot-token") ||
    lower.includes("change-me")
  );
}

function validateWebhookBaseUrl(rawBaseUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawBaseUrl);
  } catch {
    return "NEXT_PUBLIC_APP_URL không phải URL hợp lệ.";
  }

  if (parsed.protocol !== "https:") {
    return "Telegram yêu cầu webhook HTTPS. Hãy cấu hình NEXT_PUBLIC_APP_URL dạng https://...";
  }

  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
    return "Webhook không thể dùng localhost. Hãy dùng domain/public tunnel HTTPS.";
  }

  return null;
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

async function parseSetupMode(req: Request): Promise<TelegramSetupMode> {
  try {
    const body = (await req.json()) as { mode?: string } | null;
    if (body?.mode === "webhook") return "webhook";
  } catch {
    // Ignore JSON parse errors and fallback to polling mode.
  }
  return "polling";
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const token = readTelegramToken();
    if (!token) {
      return badRequest("TELEGRAM_BOT_TOKEN chưa cấu hình hợp lệ.");
    }

    const mode = await parseSetupMode(req);

    if (mode === "polling") {
      const deleted = await deleteTelegramWebhook(false);
      if (!deleted.ok) {
        return badRequest(
          `Không thể chuyển sang polling mode: ${deleted.description ?? "Unknown error"}`,
          deleted
        );
      }

      const info = await getTelegramWebhookInfo().catch(() => null);
      return ok({ mode: "polling", deleteWebhook: deleted, webhookInfo: info });
    }

    const rawBaseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.AUTH_URL?.trim();
    if (!rawBaseUrl) {
      return badRequest("Thiếu NEXT_PUBLIC_APP_URL (hoặc AUTH_URL) để đăng ký webhook.");
    }

    const normalizedBaseUrl = normalizeBaseUrl(rawBaseUrl);
    const invalidReason = validateWebhookBaseUrl(normalizedBaseUrl);
    if (invalidReason) return badRequest(invalidReason);

    const webhookUrl = `${normalizedBaseUrl}/api/telegram/webhook`;
    const result = await setTelegramWebhook(webhookUrl);

    if (!result.ok) {
      return badRequest(
        `Đăng ký webhook thất bại: ${result.description ?? "Unknown error"}`,
        { webhookUrl, telegram: result }
      );
    }

    const info = await getTelegramWebhookInfo().catch(() => null);
    return ok({ mode: "webhook", webhookUrl, setWebhook: result, webhookInfo: info });
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

    const mode: TelegramSetupMode = info.result?.url ? "webhook" : "polling";
    return ok({ mode, webhookInfo: info });
  } catch (error) {
    return handleError(error);
  }
}
