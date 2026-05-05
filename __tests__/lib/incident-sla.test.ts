import { describe, expect, it } from "vitest";
import {
  IncidentSeverity,
  IncidentStatus,
} from "@/app/generated/prisma/client";
import { computeIncidentSlaSnapshot } from "@/lib/incidents/sla";

describe("computeIncidentSlaSnapshot", () => {
  it("flags open critical incidents that exceeded acknowledge and resolve targets", () => {
    const occurredAt = new Date("2026-05-01T00:00:00.000Z");
    const now = new Date("2026-05-01T02:00:00.000Z");

    const snapshot = computeIncidentSlaSnapshot(
      {
        severity: IncidentSeverity.CRITICAL,
        status: IncidentStatus.OPEN,
        occurredAt,
        resolvedAt: null,
        lifecycleEvents: [],
      },
      now
    );

    expect(snapshot.acknowledgedBreached).toBe(true);
    expect(snapshot.resolvedBreached).toBe(true);
  });

  it("does not breach SLA when medium incident is acknowledged/resolved in time", () => {
    const occurredAt = new Date("2026-05-01T00:00:00.000Z");
    const ackAt = new Date("2026-05-01T00:10:00.000Z");
    const resolvedAt = new Date("2026-05-01T03:00:00.000Z");

    const snapshot = computeIncidentSlaSnapshot(
      {
        severity: IncidentSeverity.MEDIUM,
        status: IncidentStatus.RESOLVED,
        occurredAt,
        resolvedAt,
        lifecycleEvents: [{ toStatus: IncidentStatus.INVESTIGATING, createdAt: ackAt }],
      },
      new Date("2026-05-01T04:00:00.000Z")
    );

    expect(snapshot.acknowledgedBreached).toBe(false);
    expect(snapshot.resolvedBreached).toBe(false);
    expect(snapshot.isResolved).toBe(true);
  });
});

