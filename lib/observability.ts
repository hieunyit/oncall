import * as Sentry from "@sentry/nextjs";

export function initSentry() {
  if (!process.env.SENTRY_DSN) return;

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    // PII protection: do not send request body or user IP
    sendDefaultPii: false,
    beforeSend(event) {
      // Strip any accidentally captured PII
      if (event.user) {
        delete event.user.ip_address;
        delete event.user.email;
      }
      return event;
    },
  });
}

export function captureError(error: unknown, context?: Record<string, unknown>) {
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(error, { extra: context });
  } else {
    console.error("[Error]", error, context);
  }
}
