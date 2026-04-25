import { redis } from "@/lib/redis";
import { NextRequest, NextResponse } from "next/server";

interface RateLimitConfig {
  /** Max requests allowed in the window */
  limit: number;
  /** Window size in seconds */
  windowSeconds: number;
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

  const pipeline = redis.pipeline();
  pipeline.zremrangebyscore(key, 0, now - windowMs);
  pipeline.zadd(key, now, `${now}`);
  pipeline.zcard(key);
  pipeline.pexpire(key, windowMs);

  const results = await pipeline.exec();
  const count = (results?.[2]?.[1] as number) ?? 0;

  const remaining = Math.max(0, config.limit - count);
  const resetAt = Math.ceil((now + windowMs) / 1000);

  const headers = {
    "X-RateLimit-Limit": config.limit.toString(),
    "X-RateLimit-Remaining": remaining.toString(),
    "X-RateLimit-Reset": resetAt.toString(),
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
