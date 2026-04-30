const TELEGRAM_API = "https://api.telegram.org";

export interface TelegramSendResult {
  ok: boolean;
  result?: { message_id: number };
  description?: string;
}

export interface TelegramApiResult<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export interface TelegramWebhookInfo {
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  ip_address?: string;
  last_error_date?: number;
  last_error_message?: string;
  max_connections?: number;
  allowed_updates?: string[];
}

export interface TelegramUserRef {
  id: number;
  username?: string;
  first_name?: string;
}

export interface TelegramMessageRef {
  message_id: number;
  from?: TelegramUserRef;
  chat: { id: number; type: string };
  text?: string;
}

export interface TelegramCallbackQueryRef {
  id: string;
  from: TelegramUserRef;
  message?: { message_id: number; chat: { id: number } };
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessageRef;
  callback_query?: TelegramCallbackQueryRef;
}

function botUrl(method: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not set");
  return `${TELEGRAM_API}/bot${token}/${method}`;
}

async function parseTelegramJson<T>(res: Response): Promise<TelegramApiResult<T>> {
  const raw = await res.text();
  if (!raw) {
    return {
      ok: false,
      error_code: res.status,
      description: `Telegram API returned empty response (HTTP ${res.status})`,
    };
  }

  try {
    const parsed = JSON.parse(raw) as TelegramApiResult<T>;
    if (typeof parsed.ok === "boolean") return parsed;
    return {
      ok: false,
      error_code: res.status,
      description: `Telegram API returned malformed payload (HTTP ${res.status})`,
    };
  } catch (error) {
    const snippet = raw.slice(0, 200).replace(/\s+/g, " ");
    return {
      ok: false,
      error_code: res.status,
      description: `Telegram API JSON parse error (HTTP ${res.status}): ${(error as Error).message}. Body: ${snippet}`,
    };
  }
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  parseMode: "HTML" | "Markdown" = "HTML",
  replyMarkup?: object
): Promise<TelegramSendResult> {
  const res = await fetch(botUrl("sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: parseMode,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });
  return parseTelegramJson<{ message_id: number }>(res);
}

export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
  showAlert = false
): Promise<unknown> {
  const res = await fetch(botUrl("answerCallbackQuery"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text, show_alert: showAlert }),
  });
  return parseTelegramJson(res);
}

export async function editMessageText(
  chatId: string | number,
  messageId: number,
  text: string,
  parseMode: "HTML" | "Markdown" = "HTML",
  replyMarkup?: object
): Promise<unknown> {
  const res = await fetch(botUrl("editMessageText"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: parseMode,
      ...(replyMarkup !== undefined ? { reply_markup: replyMarkup } : {}),
    }),
  });
  return parseTelegramJson(res);
}

export function buildInlineKeyboard(templateId: string, variables: Record<string, string>): object | undefined {
  if (templateId === "shift-reminder" && variables.confirmationToken) {
    return {
      inline_keyboard: [[
        { text: "✅ Xác nhận ca trực", callback_data: `confirm:${variables.confirmationToken}` },
        { text: "❌ Từ chối", callback_data: `decline:${variables.confirmationToken}` },
      ]],
    };
  }
  if ((templateId === "alert-firing") && variables.alertId) {
    return {
      inline_keyboard: [[
        { text: "👍 Nhận cảnh báo (ACK)", callback_data: `ack:${variables.alertId}` },
      ]],
    };
  }
  return undefined;
}

export function parseTelegramExternalId(externalId: string): { chatId: string; messageId: number } | null {
  const pipe = externalId.lastIndexOf("|");
  if (pipe === -1) return null;
  const chatId = externalId.slice(0, pipe);
  const messageId = parseInt(externalId.slice(pipe + 1), 10);
  if (!chatId || isNaN(messageId)) return null;
  return { chatId, messageId };
}

export async function editTelegramDeliveries(
  deliveries: Array<{ externalId: string | null }>,
  text: string
): Promise<void> {
  const tasks = deliveries
    .map((d) => (d.externalId ? parseTelegramExternalId(d.externalId) : null))
    .filter((x): x is { chatId: string; messageId: number } => x !== null);

  await Promise.allSettled(
    tasks.map(({ chatId, messageId }) =>
      editMessageText(chatId, messageId, text, "HTML", { inline_keyboard: [] })
    )
  );
}

export function renderTelegramMessage(templateId: string, vars: Record<string, string>): string {
  const fmtVN = (iso: string) =>
    new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });

  switch (templateId) {
    case "shift-reminder": {
      const lines = [
        `📅 <b>Nhắc nhở ca trực</b>`,
        ``,
        `Xin chào ${vars.recipientName},`,
        ``,
        `Bạn có ca trực <b>${vars.policyName}</b>:`,
        `• Bắt đầu: ${fmtVN(vars.shiftStart)}`,
        `• Kết thúc: ${fmtVN(vars.shiftEnd)}`,
      ];
      if (vars.confirmationToken) {
        const confirmUrl = `${vars.appUrl}/confirm/${vars.confirmationToken}`;
        lines.push(``, `<a href="${confirmUrl}">✅ Xác nhận ca trực</a>`);
      }
      return lines.join("\n");
    }
    case "alert-firing":
      return [
        `🔴 <b>ALERT: ${vars.alertTitle}</b>`,
        ``,
        ...(vars.alertMessage ? [`${vars.alertMessage}`, ``] : []),
        ...(vars.alertSeverity ? [`Mức độ: <b>${vars.alertSeverity.toUpperCase()}</b>`, ``] : []),
        `Nhóm: ${vars.teamName} · ${vars.integrationName}`,
        ``,
        `<a href="${vars.appUrl}/alerts">Xem chi tiết</a>`,
      ].join("\n");
    case "shift-confirmed":
      return [
        `✅ <b>Ca trực đã được xác nhận</b>`,
        ``,
        `<b>${vars.recipientName}</b> đã xác nhận ca trực <b>${vars.policyName}</b>:`,
        `• Bắt đầu: ${fmtVN(vars.shiftStart)}`,
        `• Kết thúc: ${fmtVN(vars.shiftEnd)}`,
      ].join("\n");
    case "shift-declined":
      return [
        `❌ <b>Ca trực bị từ chối</b>`,
        ``,
        `<b>${vars.recipientName}</b> đã từ chối ca trực <b>${vars.policyName}</b>:`,
        `• Bắt đầu: ${fmtVN(vars.shiftStart)}`,
        `• Kết thúc: ${fmtVN(vars.shiftEnd)}`,
        ``,
        `⚠️ Cần phân công người thay thế.`,
      ].join("\n");
    case "schedule-published":
      return [
        `📋 <b>Lịch trực đã được xuất bản</b>`,
        ``,
        `Chính sách: <b>${vars.policyName}</b>`,
        `Số ca: <b>${vars.shiftCount}</b>`,
        `Từ: ${fmtVN(vars.rangeStart)}`,
        `Đến: ${fmtVN(vars.rangeEnd)}`,
        ``,
        `Người xuất bản: ${vars.actorName}`,
        ``,
        `<a href="${vars.appUrl}/schedule">Xem lịch trực</a>`,
      ].join("\n");
    case "swap-approved":
      return [
        `🔄 <b>Đổi ca được duyệt</b>`,
        ``,
        `<b>${vars.requesterName}</b> ↔ <b>${vars.targetName}</b>`,
        `Ca: ${vars.policyName}`,
        `Ngày: ${fmtVN(vars.shiftDate)}`,
        ``,
        `<a href="${vars.appUrl}/swaps">Xem chi tiết</a>`,
      ].join("\n");
    default:
      return vars.body ?? "Thông báo từ On-Call Manager";
  }
}

export async function setTelegramWebhook(webhookUrl: string): Promise<TelegramApiResult<true>> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not set");

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const res = await fetch(`${TELEGRAM_API}/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      ...(secret ? { secret_token: secret } : {}),
      allowed_updates: ["message", "callback_query"],
    }),
  });
  return parseTelegramJson<true>(res);
}

export async function getTelegramWebhookInfo(): Promise<TelegramApiResult<TelegramWebhookInfo>> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not set");

  const res = await fetch(`${TELEGRAM_API}/bot${token}/getWebhookInfo`, {
    method: "GET",
  });
  return parseTelegramJson<TelegramWebhookInfo>(res);
}

export async function deleteTelegramWebhook(
  dropPendingUpdates = false
): Promise<TelegramApiResult<true>> {
  const res = await fetch(botUrl("deleteWebhook"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ drop_pending_updates: dropPendingUpdates }),
  });
  return parseTelegramJson<true>(res);
}

export async function getTelegramUpdates(params?: {
  offset?: number;
  limit?: number;
  timeout?: number;
  allowedUpdates?: string[];
}): Promise<TelegramApiResult<TelegramUpdate[]>> {
  const body: Record<string, unknown> = {};
  if (typeof params?.offset === "number") body.offset = params.offset;
  if (typeof params?.limit === "number") body.limit = params.limit;
  if (typeof params?.timeout === "number") body.timeout = params.timeout;
  if (params?.allowedUpdates) body.allowed_updates = params.allowedUpdates;

  const res = await fetch(botUrl("getUpdates"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseTelegramJson<TelegramUpdate[]>(res);
}
