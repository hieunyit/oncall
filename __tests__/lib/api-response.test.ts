import { describe, it, expect } from "vitest";
import {
  ok,
  created,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  noContent,
} from "@/lib/api-response";

describe("api-response helpers", () => {
  it("ok returns 200 with data wrapper", async () => {
    const res = ok({ id: "1" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ id: "1" });
  });

  it("created returns 201", async () => {
    const res = created({ id: "2" });
    expect(res.status).toBe(201);
  });

  it("noContent returns 204 with no body", async () => {
    const res = noContent();
    expect(res.status).toBe(204);
    const text = await res.text();
    expect(text).toBe("");
  });

  it("badRequest returns 400 with error", async () => {
    const res = badRequest("invalid input");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid input");
  });

  it("unauthorized returns 401", async () => {
    expect(unauthorized().status).toBe(401);
  });

  it("forbidden returns 403", async () => {
    expect(forbidden().status).toBe(403);
  });

  it("notFound returns 404", async () => {
    expect(notFound().status).toBe(404);
  });

  it("conflict returns 409 with code", async () => {
    const res = conflict("version mismatch", "CONFLICT_VERSION");
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("CONFLICT_VERSION");
  });
});
