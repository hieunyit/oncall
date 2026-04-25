import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ data }, { status });
}

export function created<T>(data: T) {
  return ok(data, 201);
}

export function noContent() {
  return new NextResponse(null, { status: 204 });
}

export function badRequest(message: string, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status: 400 });
}

export function unauthorized(message = "Unauthorized") {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function forbidden(message = "Forbidden") {
  return NextResponse.json({ error: message }, { status: 403 });
}

export function notFound(message = "Not found") {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function conflict(message: string, code?: string) {
  return NextResponse.json({ error: message, code }, { status: 409 });
}

export function unprocessable(message: string, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status: 422 });
}

export function serverError(message = "Internal server error") {
  return NextResponse.json({ error: message }, { status: 500 });
}

export function handleZodError(error: ZodError) {
  return badRequest("Validation error", error.flatten().fieldErrors);
}

export function handleError(error: unknown) {
  if (error instanceof ZodError) return handleZodError(error);
  console.error(error);
  return serverError();
}
