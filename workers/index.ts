import "dotenv/config";
import { startReminderWorker } from "./reminder-worker";
import { startEscalationWorker } from "./escalation-worker";
import { startEmailWorker } from "./email-worker";
import { startTelegramWorker } from "./telegram-worker";
import { startTeamsWorker } from "./teams-worker";
import { setTelegramWebhook } from "@/lib/notifications/telegram";

console.log("Starting workers...");

const workers = [
  startReminderWorker(),
  startEscalationWorker(),
  startEmailWorker(),
  startTelegramWorker(),
  startTeamsWorker(),
];

// Auto-register Telegram webhook on startup
const appUrl = process.env.NEXT_PUBLIC_APP_URL;
if (appUrl && process.env.TELEGRAM_BOT_TOKEN) {
  setTelegramWebhook(`${appUrl}/api/telegram/webhook`)
    .then((r) => console.log("Telegram webhook registered:", JSON.stringify(r)))
    .catch((e: Error) => console.warn("Failed to register Telegram webhook:", e.message));
}

console.log(`Started ${workers.length} workers`);

process.on("SIGTERM", async () => {
  console.log("Gracefully shutting down workers...");
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
});

process.on("SIGINT", async () => {
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
});
