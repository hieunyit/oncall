import { describe, expect, it } from "vitest";
import { ShiftStatus } from "@/app/generated/prisma/client";
import { buildScheduleShiftWhere } from "@/lib/schedule/filters";

describe("buildScheduleShiftWhere", () => {
  const rangeStart = new Date("2026-06-01T00:00:00.000Z");
  const rangeEnd = new Date("2026-06-30T23:59:59.999Z");

  it("keeps both team filter and active-policy guard when teamId is provided", () => {
    const where = buildScheduleShiftWhere({
      teamId: "team-1",
      policyId: "policy-1",
      isAdmin: false,
      currentUserId: "user-1",
      rangeStart,
      rangeEnd,
    });

    expect(where.policyId).toBe("policy-1");
    expect(where.AND).toContainEqual({ policy: { teamId: "team-1" } });
    expect(where.AND).toContainEqual({ policy: { isActive: true } });
  });

  it("uses member-scoped OR access rule for non-admin users without explicit team", () => {
    const where = buildScheduleShiftWhere({
      isAdmin: false,
      currentUserId: "user-2",
      rangeStart,
      rangeEnd,
    });

    const andFilters = where.AND as Array<Record<string, unknown>>;
    expect(andFilters).toContainEqual({ policy: { isActive: true } });
    expect(andFilters).toContainEqual({
      OR: [
        { assigneeId: "user-2" },
        { policy: { team: { members: { some: { userId: "user-2" } } } } },
      ],
    });
  });

  it("does not add member-scoped access filter for admins without explicit team", () => {
    const where = buildScheduleShiftWhere({
      isAdmin: true,
      currentUserId: "admin-1",
      rangeStart,
      rangeEnd,
    });

    expect(where.AND).toEqual([{ policy: { isActive: true } }]);
  });

  it("always includes the schedule range and visible statuses", () => {
    const where = buildScheduleShiftWhere({
      isAdmin: true,
      currentUserId: "admin-2",
      rangeStart,
      rangeEnd,
    });

    expect(where.startsAt).toEqual({ lte: rangeEnd });
    expect(where.endsAt).toEqual({ gte: rangeStart });
    expect(where.status).toEqual({
      in: [ShiftStatus.PUBLISHED, ShiftStatus.ACTIVE, ShiftStatus.COMPLETED],
    });
  });
});

