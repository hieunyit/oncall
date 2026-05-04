import { describe, expect, it } from "vitest";
import {
  pruneAutoScheduleConflicts,
  validateAutoScheduleOneShiftPerDay,
} from "@/lib/rotation/auto-schedule-validation";

describe("validateAutoScheduleOneShiftPerDay", () => {
  it("flags duplicate generated shifts in the same day", () => {
    const violation = validateAutoScheduleOneShiftPerDay({
      generatedShifts: [
        {
          assigneeId: "u1",
          startsAt: new Date("2026-01-01T01:00:00Z"),
          endsAt: new Date("2026-01-01T09:00:00Z"),
        },
        {
          assigneeId: "u1",
          startsAt: new Date("2026-01-01T10:00:00Z"),
          endsAt: new Date("2026-01-01T18:00:00Z"),
        },
      ],
      existingShifts: [],
      timezone: "UTC",
    });

    expect(violation?.code).toBe("AUTO_SAME_DAY_DUPLICATE");
  });

  it("flags generated shifts that collide with existing shifts by day", () => {
    const violation = validateAutoScheduleOneShiftPerDay({
      generatedShifts: [
        {
          assigneeId: "u2",
          startsAt: new Date("2026-02-01T08:00:00Z"),
          endsAt: new Date("2026-02-01T16:00:00Z"),
        },
      ],
      existingShifts: [
        {
          id: "s-existing",
          assigneeId: "u2",
          startsAt: new Date("2026-02-01T18:00:00Z"),
          endsAt: new Date("2026-02-02T02:00:00Z"),
        },
      ],
      timezone: "UTC",
    });

    expect(violation?.code).toBe("AUTO_CONFLICT_EXISTING_SHIFT");
  });

  it("allows shifts when there is no same-day conflict", () => {
    const violation = validateAutoScheduleOneShiftPerDay({
      generatedShifts: [
        {
          assigneeId: "u3",
          startsAt: new Date("2026-03-01T08:00:00Z"),
          endsAt: new Date("2026-03-01T16:00:00Z"),
        },
      ],
      existingShifts: [
        {
          id: "s-old",
          assigneeId: "u3",
          startsAt: new Date("2026-02-28T08:00:00Z"),
          endsAt: new Date("2026-02-28T16:00:00Z"),
        },
      ],
      timezone: "UTC",
    });

    expect(violation).toBeNull();
  });

  it("prunes conflicting shifts instead of failing", () => {
    const result = pruneAutoScheduleConflicts({
      generatedShifts: [
        {
          assigneeId: "u4",
          startsAt: new Date("2026-04-01T08:00:00Z"),
          endsAt: new Date("2026-04-01T16:00:00Z"),
        },
        {
          assigneeId: "u4",
          startsAt: new Date("2026-04-01T18:00:00Z"),
          endsAt: new Date("2026-04-02T02:00:00Z"),
        },
        {
          assigneeId: "u5",
          startsAt: new Date("2026-04-01T08:00:00Z"),
          endsAt: new Date("2026-04-01T16:00:00Z"),
        },
      ],
      existingShifts: [],
      timezone: "UTC",
    });

    expect(result.dropped).toBe(1);
    expect(result.shifts).toHaveLength(2);
  });
});
