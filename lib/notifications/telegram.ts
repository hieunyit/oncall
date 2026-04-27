const TELEGRAM_API = "https://api.telegram.org";

export interface TelegramSendResult {
  ok: boolean;
  result?: { message_id: number };
  description?: string;
}

function botUrl(method: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not set");
  return `${TELEGRAM_API}/bot${token}/${method}`;
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
  return res.json();
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
  return res.json();
}

export async function editMessageText(
  chatId: string | number,
  messageId: number,
  text: string,
  parseMode: "HTML" | "Markdown" = "HTML"
): Promise<unknown> {
  const res = await fetch(botUrl("editMessageText"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: parseMode,
    }),
  });
  return res.json();
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

export function renderTelegramMessage(templateId: string, vars: Record<string, string>): string {
  const confirmUrl = `${vars.appUrl}/confirm/${vars.confirmationToken}`;

  const fmtVN = (iso: string) =>
    new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });

  switch (templateId) {
    case "shift-reminder":
      return [
        `📅 <b>Nhắc nhở ca trực</b>`,
        ``,
        `Xin chào ${vars.recipientName},`,
        ``,
        `Bạn có ca trực <b>${vars.policyName}</b>:`,
        `• Bắt đầu: ${fmtVN(vars.shiftStart)}`,
        `• Kết thúc: ${fmtVN(vars.shiftEnd)}`,
        ``,
        `<a href="${confirmUrl}">✅ Xác nhận ca trực</a>`,
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

export async function setTelegramWebhook(webhookUrl: string): Promise<unknown> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not set");

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const res = await fetch(`${TELEGRAM_API}/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secret,
      allowed_updates: ["message"],
    }),
  });
  return res.json();
}
