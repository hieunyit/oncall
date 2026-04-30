import {
  deleteTelegramWebhook,
  getTelegramUpdates,
  type TelegramUpdate,
} from "@/lib/notifications/telegram";
import { processTelegramUpdate } from "@/lib/telegram/process-update";

type Closable = { close: () => Promise<void> };

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

export function startTelegramUpdatePoller(): Closable {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    console.warn("[telegram-poller] TELEGRAM_BOT_TOKEN is missing. Poller is disabled.");
    return { close: async () => {} };
  }

  const pollIntervalMs = parsePositiveInt(process.env.TELEGRAM_POLL_INTERVAL_MS, 2000);
  const pollLimit = parsePositiveInt(process.env.TELEGRAM_POLL_LIMIT, 100);

  let stopped = false;
  let timeoutRef: NodeJS.Timeout | null = null;
  let offset: number | undefined;
  let running = false;

  const scheduleNextTick = (delayMs: number) => {
    if (stopped) return;
    timeoutRef = setTimeout(() => {
      void runOnce();
    }, delayMs);
  };

  const runOnce = async () => {
    if (stopped || running) return;
    running = true;

    try {
      const res = await getTelegramUpdates({
        offset,
        limit: pollLimit,
        timeout: 0,
        allowedUpdates: ["message", "callback_query"],
      });

      if (!res.ok) {
        console.warn("[telegram-poller] getUpdates failed:", res.description ?? "Unknown error");
        scheduleNextTick(pollIntervalMs);
        return;
      }

      const updates = Array.isArray(res.result) ? (res.result as TelegramUpdate[]) : [];
      let processed = 0;
      for (const update of updates) {
        try {
          await processTelegramUpdate(update);
          offset = update.update_id + 1;
          processed += 1;
        } catch (error) {
          console.error("[telegram-poller] process update failed:", error);
          break;
        }
      }

      // If we just processed a full page, fetch again immediately to drain backlog quickly.
      scheduleNextTick(processed >= pollLimit ? 0 : pollIntervalMs);
    } catch (error) {
      console.error("[telegram-poller] unexpected poll error:", error);
      scheduleNextTick(pollIntervalMs);
    } finally {
      running = false;
    }
  };

  void (async () => {
    try {
      const result = await deleteTelegramWebhook(true);
      if (!result.ok) {
        console.warn(
          "[telegram-poller] failed to disable webhook, polling may not receive updates:",
          result.description ?? "Unknown error"
        );
      } else {
        console.log("[telegram-poller] webhook disabled; polling mode enabled (dropped stale updates).");
      }
    } catch (error) {
      console.error("[telegram-poller] failed to disable webhook:", error);
    }

    scheduleNextTick(0);
  })();

  return {
    close: async () => {
      stopped = true;
      if (timeoutRef) clearTimeout(timeoutRef);
    },
  };
}
