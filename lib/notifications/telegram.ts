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

export interface TelegramBotCommand {
  command: string;
  description: string;
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
  caption?: string;
  photo?: TelegramPhotoSizeRef[];
}

export interface TelegramPhotoSizeRef {
  file_id: string;
  file_unique_id?: string;
  width: number;
  height: number;
  file_size?: number;
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

export async function sendTelegramPhoto(
  chatId: string,
  photo: string,
  caption?: string,
  replyMarkup?: object
): Promise<TelegramSendResult> {
  const res = await fetch(botUrl("sendPhoto"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      photo,
      ...(caption ? { caption, parse_mode: "HTML" } : {}),
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });
  return parseTelegramJson<{ message_id: number }>(res);
}

export async function sendTelegramDocument(
  chatId: string,
  params: {
    fileName: string;
    bytes: Buffer | Uint8Array;
    caption?: string;
    contentType?: string;
    replyMarkup?: object;
  }
): Promise<TelegramSendResult> {
  const formData = new FormData();
  formData.set("chat_id", chatId);

  const inputBytes = params.bytes instanceof Uint8Array ? params.bytes : new Uint8Array(params.bytes);
  const arrayBuffer = inputBytes.buffer.slice(
    inputBytes.byteOffset,
    inputBytes.byteOffset + inputBytes.byteLength
  ) as ArrayBuffer;
  const blob = new Blob([arrayBuffer], {
    type: params.contentType ?? "application/octet-stream",
  });
  formData.set("document", blob, params.fileName);

  if (params.caption?.trim()) {
    formData.set("caption", params.caption.trim());
    formData.set("parse_mode", "HTML");
  }
  if (params.replyMarkup) {
    formData.set("reply_markup", JSON.stringify(params.replyMarkup));
  }

  const res = await fetch(botUrl("sendDocument"), {
    method: "POST",
    body: formData,
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
  if (templateId === "shift-reminder" && (variables.confirmationId || variables.confirmationToken)) {
    const confirmData = variables.confirmationId
      ? `confirm-id:${variables.confirmationId}`
      : `confirm:${variables.confirmationToken}`;
    const declineData = variables.confirmationId
      ? `decline-id:${variables.confirmationId}`
      : `decline:${variables.confirmationToken}`;
    const rows: Array<Array<{ text: string; callback_data: string }>> = [[
      { text: "✅ Xác nhận ca trực", callback_data: confirmData },
      { text: "❌ Từ chối", callback_data: declineData },
    ]];
    if (variables.requirePhotoOnConfirm === "1" && variables.confirmationId) {
      rows.push([{ text: "📷 Gửi ảnh check-in", callback_data: `proof-in:${variables.confirmationId}` }]);
    }
    return {
      inline_keyboard: rows,
    };
  }
  if (templateId === "shift-end-reminder" && variables.shiftId) {
    return {
      inline_keyboard: [[
        { text: "📷 Gửi ảnh check-out", callback_data: `proof-out:${variables.shiftId}` },
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
      if (vars.requirePhotoOnConfirm === "1") {
        lines.push(``, `📷 Policy này yêu cầu ảnh check-in khi xác nhận ca.`);
      }
      if (vars.confirmationToken) {
        const confirmUrl = `${vars.appUrl}/confirm/${vars.confirmationToken}`;
        lines.push(``, `<a href="${confirmUrl}">✅ Xác nhận ca trực</a>`);
      }
      return lines.join("\n");
    }
    case "shift-end-reminder":
      return [
        `⏱️ <b>Nhắc nhở hết ca trực</b>`,
        ``,
        `Xin chào ${vars.recipientName},`,
        `Ca trực <b>${vars.policyName}</b> đã đến giờ kết thúc.`,
        `• Bắt đầu: ${fmtVN(vars.shiftStart)}`,
        `• Kết thúc: ${fmtVN(vars.shiftEnd)}`,
        ...(vars.requirePhotoOnCheckout === "1"
          ? [``, `📷 Vui lòng gửi ảnh check-out để xác nhận kết ca.`]
          : []),
      ].join("\n");
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

export interface TelegramFileRef {
  file_id: string;
  file_unique_id?: string;
  file_size?: number;
  file_path?: string;
}

export async function getTelegramFile(fileId: string): Promise<TelegramApiResult<TelegramFileRef>> {
  const res = await fetch(botUrl("getFile"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
  });
  return parseTelegramJson<TelegramFileRef>(res);
}

export function buildTelegramFileDownloadUrl(filePath: string): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not set");
  return `${TELEGRAM_API}/file/bot${token}/${filePath}`;
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

export async function setTelegramCommands(
  commands: TelegramBotCommand[]
): Promise<TelegramApiResult<true>> {
  const res = await fetch(botUrl("setMyCommands"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      commands: commands.map((c) => ({
        command: c.command.trim().toLowerCase(),
        description: c.description.trim().slice(0, 256),
      })),
    }),
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
