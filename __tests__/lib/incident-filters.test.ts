import { describe, expect, it } from "vitest";
import {
  IncidentSeverity,
  IncidentStatus,
} from "@/app/generated/prisma/client";
import { buildIncidentWhere } from "@/lib/incidents/filters";

describe("buildIncidentWhere", () => {
  const rangeStart = new Date("2026-05-01T00:00:00.000Z");
  const rangeEnd = new Date("2026-05-31T23:59:59.999Z");

  it("builds a strict AND where with team/policy/status/severity/keyword", () => {
    const where = buildIncidentWhere({
      rangeStart,
      rangeEnd,
      selectedTeamId: "team-1",
      selectedPolicyId: "policy-1",
      statusFilter: IncidentStatus.OPEN,
      severityFilter: IncidentSeverity.CRITICAL,
      keyword: "timeout",
      isAdmin: true,
    });

    const andFilters = where.AND as Array<Record<string, unknown>>;
    expect(andFilters).toContainEqual({
      occurredAt: { gte: rangeStart, lte: rangeEnd },
    });
    expect(andFilters).toContainEqual({ teamId: "team-1" });
    expect(andFilters).toContainEqual({ policyId: "policy-1" });
    expect(andFilters).toContainEqual({ status: IncidentStatus.OPEN });
    expect(andFilters).toContainEqual({ severity: IncidentSeverity.CRITICAL });
    expect(andFilters.some((item) => "OR" in item)).toBe(true);
  });

  it("applies allowed team scope for non-admin users when no explicit teamId", () => {
    const where = buildIncidentWhere({
      rangeStart,
      rangeEnd,
      isAdmin: false,
      allowedTeamIds: ["team-a", "team-b"],
    });

    const andFilters = where.AND as Array<Record<string, unknown>>;
    expect(andFilters).toContainEqual({ teamId: { in: ["team-a", "team-b"] } });
  });
});

