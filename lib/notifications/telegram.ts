const TELEGRAM_API = "https://api.telegram.org";

export interface TelegramSendResult {
  ok: boolean;
  result?: { message_id: number };
  description?: string;
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  parseMode: "HTML" | "Markdown" = "HTML"
): Promise<TelegramSendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not set");

  const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode }),
  });

  return res.json();
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
