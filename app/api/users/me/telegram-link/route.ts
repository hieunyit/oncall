import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/rbac";
import { ok, unauthorized, handleError } from "@/lib/api-response";

// POST /api/users/me/telegram-link
// Generates a 10-minute deep-link token for the caller to connect their Telegram account.
// The user opens t.me/<botUsername>?start=<token> which triggers the /start command in the bot.
export async function POST() {
  try {
    const user = await getSessionUser();
    if (!user) return unauthorized();

    const token = randomBytes(16).toString("hex");
    const exp = new Date(Date.now() + 10 * 60 * 1000); // expires in 10 minutes

    await prisma.user.update({
      where: { id: user.id },
      data: { telegramLinkToken: token, telegramLinkTokenExp: exp },
    });

    const botUsername = process.env.TELEGRAM_BOT_USERNAME;
    const linkUrl = botUsername ? `https://t.me/${botUsername}?start=${token}` : null;
    const startCommand = `/start ${token}`;
    const linkCommand = `/link ${token}`;

    return ok({ linkUrl, token, exp, botUsername: botUsername ?? null, startCommand, linkCommand });
  } catch (error) {
    return handleError(error);
  }
}

// DELETE /api/users/me/telegram-link
// Unlinks the caller's Telegram account.
export async function DELETE() {
  try {
    const user = await getSessionUser();
    if (!user) return unauthorized();

    await prisma.user.update({
      where: { id: user.id },
      data: {
        telegramChatId: null,
        telegramLinkToken: null,
        telegramLinkTokenExp: null,
      },
    });

    return ok({ unlinked: true });
  } catch (error) {
    return handleError(error);
  }
}
