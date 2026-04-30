import { NextResponse } from "next/server";
import { ZodError } from "zod";

function stringifyJsonSafe(value: unknown): string {
  const body = JSON.stringify(value, (_key, val) => {
    if (typeof val === "bigint") return val.toString();
    return val;
  });
  return body ?? "null";
}

function jsonResponse(value: unknown, status: number) {
  return new NextResponse(stringifyJsonSafe(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

export function ok<T>(data: T, status = 200) {
  return jsonResponse({ data }, status);
}

export function created<T>(data: T) {
  return ok(data, 201);
}

export function noContent() {
  return new NextResponse(null, { status: 204 });
}

export function badRequest(message: string, details?: unknown) {
  return jsonResponse({ error: message, details }, 400);
}

export function unauthorized(message = "Unauthorized") {
  return jsonResponse({ error: message }, 401);
}

export function forbidden(message = "Forbidden") {
  return jsonResponse({ error: message }, 403);
}

export function notFound(message = "Not found") {
  return jsonResponse({ error: message }, 404);
}

export function conflict(message: string, code?: string) {
  return jsonResponse({ error: message, code }, 409);
}

export function unprocessable(message: string, details?: unknown) {
  return jsonResponse({ error: message, details }, 422);
}

export function serverError(message = "Internal server error") {
  return jsonResponse({ error: message }, 500);
}

export function handleZodError(error: ZodError) {
  return badRequest("Validation error", error.flatten().fieldErrors);
}

export function handleError(error: unknown) {
  if (error instanceof ZodError) return handleZodError(error);
  console.error(error);
  return serverError();
}
