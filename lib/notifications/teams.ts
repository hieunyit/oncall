export interface TeamsCard {
  type: string;
  attachments: Array<{
    contentType: string;
    content: Record<string, unknown>;
  }>;
}

export function buildTeamsAdaptiveCard(
  templateId: string,
  vars: Record<string, string>
): TeamsCard {
  const confirmUrl = `${vars.appUrl}/confirm/${vars.confirmationToken}`;

  const card = {
    type: "AdaptiveCard",
    version: "1.4",
    body: [
      {
        type: "TextBlock",
        text: "📅 Nhắc nhở ca trực",
        weight: "Bolder",
        size: "Medium",
      },
      {
        type: "FactSet",
        facts: [
          { title: "Người trực:", value: vars.recipientName },
          { title: "Chính sách:", value: vars.policyName },
          { title: "Bắt đầu:", value: new Date(vars.shiftStart).toLocaleString("vi-VN") },
          { title: "Kết thúc:", value: new Date(vars.shiftEnd).toLocaleString("vi-VN") },
        ],
      },
    ],
    actions: [
      {
        type: "Action.OpenUrl",
        title: "Xác nhận ca trực",
        url: confirmUrl,
        style: "positive",
      },
    ],
  };

  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: card,
      },
    ],
  };
}

export async function sendTeamsWebhook(
  webhookUrl: string,
  payload: TeamsCard
): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Teams webhook failed: ${res.status} ${body}`);
  }
}
