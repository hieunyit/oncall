import { ensureRedisReady, getRedis } from "@/lib/redis";
import { NextRequest, NextResponse } from "next/server";

interface RateLimitConfig {
  /** Max requests allowed in the window */
  limit: number;
  /** Window size in seconds */
  windowSeconds: number;
}

type MemoryBucket = {
  hits: number[];
};

const memoryBuckets = new Map<string, MemoryBucket>();

function consumeInMemoryRateLimit(
  key: string,
  now: number,
  windowMs: number,
  limit: number
) {
  const bucket = memoryBuckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((ts) => ts > now - windowMs);
  bucket.hits.push(now);
  memoryBuckets.set(key, bucket);

  const count = bucket.hits.length;
  const remaining = Math.max(0, limit - count);
  const resetAt = Math.ceil((now + windowMs) / 1000);
  return { count, remaining, resetAt, backend: "memory" as const };
}

/**
 * Sliding window rate limiter using Redis.
 * Returns null if under limit, or a 429 NextResponse if exceeded.
 */
export async function rateLimit(
  req: NextRequest,
  config: RateLimitConfig
): Promise<NextResponse | null> {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const key = `rl:${req.nextUrl.pathname}:${ip}`;
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;
  const redis = getRedis();

  let count = 0;
  let remaining = 0;
  let resetAt = 0;
  let backend: "redis" | "memory" = "memory";

  const canUseRedis = await ensureRedisReady(redis);
  if (canUseRedis && redis) {
    try {
      const member = `${now}-${Math.random().toString(36).slice(2, 8)}`;
      const pipeline = redis.pipeline();
      pipeline.zremrangebyscore(key, 0, now - windowMs);
      pipeline.zadd(key, now, member);
      pipeline.zcard(key);
      pipeline.pexpire(key, windowMs);

      const results = await pipeline.exec();
      count = (results?.[2]?.[1] as number) ?? 0;
      remaining = Math.max(0, config.limit - count);
      resetAt = Math.ceil((now + windowMs) / 1000);
      backend = "redis";
    } catch {
      const memoryResult = consumeInMemoryRateLimit(
        key,
        now,
        windowMs,
        config.limit
      );
      count = memoryResult.count;
      remaining = memoryResult.remaining;
      resetAt = memoryResult.resetAt;
      backend = memoryResult.backend;
    }
  } else {
    const memoryResult = consumeInMemoryRateLimit(
      key,
      now,
      windowMs,
      config.limit
    );
    count = memoryResult.count;
    remaining = memoryResult.remaining;
    resetAt = memoryResult.resetAt;
    backend = memoryResult.backend;
  }

  const headers = {
    "X-RateLimit-Limit": config.limit.toString(),
    "X-RateLimit-Remaining": remaining.toString(),
    "X-RateLimit-Reset": resetAt.toString(),
    "X-RateLimit-Backend": backend,
  };

  if (count > config.limit) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers }
    );
  }

  return null;
}

// Pre-configured limiters for common use cases
export const RATE_LIMITS = {
  /** Strict limit for auth actions */
  AUTH: { limit: 10, windowSeconds: 60 },
  /** Standard API limit */
  API: { limit: 120, windowSeconds: 60 },
  /** Publish / write heavy operations */
  WRITE: { limit: 30, windowSeconds: 60 },
  /** Telegram webhook — Telegram sends bursts */
  WEBHOOK: { limit: 500, windowSeconds: 60 },
} as const;
