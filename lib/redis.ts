import Redis, { type RedisOptions } from "ioredis";

type RedisGlobalState = {
  redis?: Redis | null;
  redisWarnedAt?: number;
};

const globalState = globalThis as unknown as RedisGlobalState;

function redisUrl() {
  return process.env.REDIS_URL ?? "redis://localhost:6379";
}

function isBuildTime() {
  return process.env.NEXT_PHASE === "phase-production-build";
}

function shouldDisableRedis() {
  return process.env.DISABLE_REDIS === "1" || isBuildTime();
}

function logRedisIssue(prefix: string, error: unknown) {
  const now = Date.now();
  const last = globalState.redisWarnedAt ?? 0;
  if (now - last < 60_000) return;
  globalState.redisWarnedAt = now;

  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as NodeJS.ErrnoException).code)
      : "UNKNOWN";
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as Error).message)
      : String(error);

  console.warn(`[redis:${prefix}] ${code} ${message}`);
}

function attachRedisEventHandlers(client: Redis, label: string) {
  client.on("error", (error) => {
    logRedisIssue(label, error);
  });
}

function createClient(label: string, opts?: Partial<RedisOptions>) {
  const client = new Redis(redisUrl(), {
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    lazyConnect: true,
    retryStrategy: (attempt) => Math.min(attempt * 100, 2_000),
    ...opts,
  });
  attachRedisEventHandlers(client, label);
  return client;
}

export function getRedis(): Redis | null {
  if (shouldDisableRedis()) return null;
  if (!globalState.redis) {
    globalState.redis = createClient("app");
  }
  return globalState.redis;
}

export async function ensureRedisReady(client: Redis | null): Promise<boolean> {
  if (!client) return false;
  if ((client.status as string) === "ready") return true;
  try {
    if (client.status === "wait") {
      await client.connect();
    }
    return (client.status as string) === "ready";
  } catch (error) {
    logRedisIssue("connect", error);
    return false;
  }
}

export function createRedisConnection(label = "queue") {
  // BullMQ workers use blocking commands and require maxRetriesPerRequest: null.
  if (shouldDisableRedis()) {
    return createClient(`${label}:disabled`, { maxRetriesPerRequest: null });
  }
  return createClient(label, { maxRetriesPerRequest: null });
}
