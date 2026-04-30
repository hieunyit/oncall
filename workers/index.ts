import "dotenv/config";
import { startReminderWorker } from "./reminder-worker";
import { startEscalationWorker } from "./escalation-worker";
import { startEmailWorker } from "./email-worker";
import { startTelegramWorker } from "./telegram-worker";
import { startTeamsWorker } from "./teams-worker";
import { startTelegramUpdatePoller } from "./telegram-update-poller";

console.log("Starting workers...");

const workers = [
  startReminderWorker(),
  startEscalationWorker(),
  startEmailWorker(),
  startTelegramWorker(),
  startTeamsWorker(),
  startTelegramUpdatePoller(),
];

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
