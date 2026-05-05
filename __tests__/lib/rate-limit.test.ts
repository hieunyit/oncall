import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/redis", () => ({
  getRedis: vi.fn(),
  ensureRedisReady: vi.fn(),
}));

import { rateLimit } from "@/lib/rate-limit";
import { ensureRedisReady, getRedis } from "@/lib/redis";

const mockGetRedis = getRedis as unknown as ReturnType<typeof vi.fn>;
const mockEnsureRedisReady = ensureRedisReady as unknown as ReturnType<
  typeof vi.fn
>;

function makeRequest(path = "/api/test", ip = "10.0.0.1") {
  return new NextRequest(`http://localhost${path}`, {
    headers: { "x-forwarded-for": ip },
  });
}

describe("rateLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when redis backend is under limit", async () => {
    const pipeline = {
      zremrangebyscore: vi.fn().mockReturnThis(),
      zadd: vi.fn().mockReturnThis(),
      zcard: vi.fn().mockReturnThis(),
      pexpire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([
        [null, 0],
        [null, 1],
        [null, 2],
        [null, 1],
      ]),
    };

    mockGetRedis.mockReturnValue({ pipeline: () => pipeline });
    mockEnsureRedisReady.mockResolvedValue(true);

    const res = await rateLimit(makeRequest("/api/test-redis-ok"), {
      limit: 3,
      windowSeconds: 60,
    });

    expect(res).toBeNull();
    expect(pipeline.exec).toHaveBeenCalled();
  });

  it("returns 429 when redis backend exceeds limit", async () => {
    const pipeline = {
      zremrangebyscore: vi.fn().mockReturnThis(),
      zadd: vi.fn().mockReturnThis(),
      zcard: vi.fn().mockReturnThis(),
      pexpire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([
        [null, 0],
        [null, 1],
        [null, 4],
        [null, 1],
      ]),
    };

    mockGetRedis.mockReturnValue({ pipeline: () => pipeline });
    mockEnsureRedisReady.mockResolvedValue(true);

    const res = await rateLimit(makeRequest("/api/test-redis-block"), {
      limit: 3,
      windowSeconds: 60,
    });

    expect(res?.status).toBe(429);
    expect(res?.headers.get("X-RateLimit-Backend")).toBe("redis");
  });

  it("falls back to memory backend when redis is unavailable", async () => {
    mockGetRedis.mockReturnValue(null);
    mockEnsureRedisReady.mockResolvedValue(false);

    const path = `/api/test-memory-${Date.now()}`;
    const config = { limit: 2, windowSeconds: 60 };

    const first = await rateLimit(makeRequest(path, "10.0.0.2"), config);
    const second = await rateLimit(makeRequest(path, "10.0.0.2"), config);
    const third = await rateLimit(makeRequest(path, "10.0.0.2"), config);

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(third?.status).toBe(429);
    expect(third?.headers.get("X-RateLimit-Backend")).toBe("memory");
  });
});

