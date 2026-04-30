import { describe, it, expect } from "vitest";
import {
  generateShifts,
  computeConfirmationDueAt,
  computeReminderFireAt,
} from "@/lib/rotation/engine";
import { CadenceKind } from "@/app/generated/prisma/client";

const basePolicy = {
  cadence: CadenceKind.WEEKLY,
  cronExpression: null,
  shiftDurationHours: 168, // 7 days
  handoverOffsetMinutes: 0,
  confirmationDueHours: 24,
  reminderLeadHours: [48, 24],
};

const participants = [
  { userId: "user-1" },
  { userId: "user-2" },
  { userId: "user-3" },
];

describe("generateShifts", () => {
  it("generates correct number of weekly shifts for 4 weeks with 3 participants", () => {
    const start = new Date("2026-01-05T00:00:00Z"); // Monday
    const end = new Date("2026-02-02T00:00:00Z");   // 4 weeks later

    const shifts = generateShifts(basePolicy, participants, start, end);
    expect(shifts).toHaveLength(4);
  });

  it("rotates participants in order", () => {
    const start = new Date("2026-01-05T00:00:00Z");
    const end = new Date("2026-01-26T00:00:00Z"); // 3 weeks

    const shifts = generateShifts(basePolicy, participants, start, end);
    expect(shifts[0].assigneeId).toBe("user-1");
    expect(shifts[1].assigneeId).toBe("user-2");
    expect(shifts[2].assigneeId).toBe("user-3");
  });

  it("wraps around when participants are exhausted", () => {
    const start = new Date("2026-01-05T00:00:00Z");
    const end = new Date("2026-02-16T00:00:00Z"); // 6 weeks

    const shifts = generateShifts(basePolicy, participants, start, end);
    expect(shifts).toHaveLength(6);
    expect(shifts[3].assigneeId).toBe("user-1");
    expect(shifts[4].assigneeId).toBe("user-2");
  });

  it("respects startingIndex offset", () => {
    const start = new Date("2026-01-05T00:00:00Z");
    const end = new Date("2026-01-26T00:00:00Z");

    const shifts = generateShifts(basePolicy, participants, start, end, 1);
    expect(shifts[0].assigneeId).toBe("user-2");
  });

  it("generates correct shift times", () => {
    const start = new Date("2026-01-05T00:00:00Z");
    const end = new Date("2026-01-12T00:00:00Z");

    const shifts = generateShifts(basePolicy, participants, start, end);
    expect(shifts[0].startsAt).toEqual(start);
    expect(shifts[0].endsAt).toEqual(new Date("2026-01-12T00:00:00Z"));
  });

  it("returns empty array when no participants", () => {
    const start = new Date("2026-01-05T00:00:00Z");
    const end = new Date("2026-02-02T00:00:00Z");

    expect(generateShifts(basePolicy, [], start, end)).toEqual([]);
  });

  it("returns empty array when range is zero-length", () => {
    const date = new Date("2026-01-05T00:00:00Z");
    expect(generateShifts(basePolicy, participants, date, date)).toEqual([]);
  });

  it("handles DAILY cadence", () => {
    const dailyPolicy = { ...basePolicy, cadence: CadenceKind.DAILY, shiftDurationHours: 24 };
    const start = new Date("2026-01-05T00:00:00Z");
    const end = new Date("2026-01-12T00:00:00Z");

    const shifts = generateShifts(dailyPolicy, participants, start, end);
    expect(shifts).toHaveLength(7);
    expect(shifts.every((s, i) => {
      const expectedStart = new Date(start.getTime() + i * 24 * 3600 * 1000);
      return s.startsAt.getTime() === expectedStart.getTime();
    })).toBe(true);
  });

  it("applies handoverOffsetMinutes to endsAt", () => {
    const policyWithOffset = { ...basePolicy, handoverOffsetMinutes: 30 };
    const start = new Date("2026-01-05T00:00:00Z");
    const end = new Date("2026-01-19T00:00:00Z");

    const shifts = generateShifts(policyWithOffset, participants, start, end);
    // endsAt should be shiftDurationHours + 30 min after start
    const expectedEndsAt = new Date(start.getTime() + (168 * 3600 + 30 * 60) * 1000);
    expect(shifts[0].endsAt).toEqual(expectedEndsAt);
  });

  it("rotates late slot evenly for 3 people / 3 slots and avoids consecutive late shifts", () => {
    const policyWithSlots = {
      ...basePolicy,
      cadence: CadenceKind.DAILY,
      shiftDurationHours: 24,
      timezone: "Asia/Ho_Chi_Minh",
      timeSlots: [
        { label: "Night", startHour: 22, startMinute: 0, endHour: 23, endMinute: 59 },
        { label: "Morning", startHour: 6, startMinute: 0, endHour: 14, endMinute: 0 },
        { label: "Afternoon", startHour: 14, startMinute: 0, endHour: 22, endMinute: 0 },
      ],
    };
    const start = new Date("2026-01-01T00:00:00Z");
    const end = new Date("2026-01-07T00:00:00Z"); // 6 days

    const shifts = generateShifts(policyWithSlots, participants, start, end);
    expect(shifts).toHaveLength(18);

    const byDay = new Map<string, typeof shifts>();
    for (const shift of shifts) {
      const key = shift.startsAt.toISOString().slice(0, 10);
      byDay.set(key, [...(byDay.get(key) ?? []), shift]);
    }

    const lateAssignees = [...byDay.values()]
      .map((items) => items.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[items.length - 1].assigneeId);

    for (let i = 1; i < lateAssignees.length; i++) {
      expect(lateAssignees[i]).not.toBe(lateAssignees[i - 1]);
    }

    const counts = new Map<string, number>();
    for (const userId of lateAssignees) {
      counts.set(userId, (counts.get(userId) ?? 0) + 1);
    }
    const countValues = [...counts.values()];
    expect(Math.max(...countValues) - Math.min(...countValues)).toBeLessThanOrEqual(1);
  });

  it("avoids assigning the same user to late slot on consecutive days for 2+ slots/day", () => {
    const policyWithSlots = {
      ...basePolicy,
      cadence: CadenceKind.DAILY,
      shiftDurationHours: 24,
      timezone: "Asia/Ho_Chi_Minh",
      timeSlots: [
        { label: "Late", startHour: 16, startMinute: 0, endHour: 23, endMinute: 0 },
        { label: "Early", startHour: 8, startMinute: 0, endHour: 16, endMinute: 0 },
      ],
    };
    const start = new Date("2026-01-01T00:00:00Z");
    const end = new Date("2026-01-06T00:00:00Z"); // 5 days

    const shifts = generateShifts(policyWithSlots, participants, start, end);
    expect(shifts).toHaveLength(10);

    const byDay = new Map<string, typeof shifts>();
    for (const shift of shifts) {
      const key = shift.startsAt.toISOString().slice(0, 10);
      byDay.set(key, [...(byDay.get(key) ?? []), shift]);
    }

    const lateAssignees = [...byDay.values()]
      .map((items) => items.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[items.length - 1].assigneeId);

    for (let i = 1; i < lateAssignees.length; i++) {
      expect(lateAssignees[i]).not.toBe(lateAssignees[i - 1]);
    }
  });
});

describe("computeConfirmationDueAt", () => {
  it("returns shift start minus confirmation hours", () => {
    const shift = {
      assigneeId: "user-1",
      startsAt: new Date("2026-01-12T09:00:00Z"),
      endsAt: new Date("2026-01-19T09:00:00Z"),
    };
    const due = computeConfirmationDueAt(shift, 24);
    expect(due).toEqual(new Date("2026-01-11T09:00:00Z"));
  });
});

describe("computeReminderFireAt", () => {
  it("returns shift start minus lead hours", () => {
    const shift = {
      assigneeId: "user-1",
      startsAt: new Date("2026-01-12T09:00:00Z"),
      endsAt: new Date("2026-01-19T09:00:00Z"),
    };
    expect(computeReminderFireAt(shift, 48)).toEqual(new Date("2026-01-10T09:00:00Z"));
    expect(computeReminderFireAt(shift, 2)).toEqual(new Date("2026-01-12T07:00:00Z"));
  });
});
