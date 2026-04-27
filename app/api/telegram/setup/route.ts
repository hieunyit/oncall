import { getSessionUser } from "@/lib/rbac";
import { unauthorized, forbidden, ok, handleError } from "@/lib/api-response";
import { setTelegramWebhook } from "@/lib/notifications/telegram";
import { SystemRole } from "@/app/generated/prisma/client";

export async function POST() {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();
    if (actor.systemRole !== SystemRole.ADMIN) return forbidden("Admin only");

    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!appUrl) return ok({ error: "NEXT_PUBLIC_APP_URL not set" });
    if (!process.env.TELEGRAM_BOT_TOKEN) return ok({ error: "TELEGRAM_BOT_TOKEN not set" });

    const result = await setTelegramWebhook(`${appUrl}/api/telegram/webhook`);
    return ok(result);
  } catch (error) {
    return handleError(error);
  }
}
