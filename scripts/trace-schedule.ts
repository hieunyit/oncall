import { generateShifts } from "../lib/rotation/engine";
import { CadenceKind } from "../app/generated/prisma/client";

const base = {
  cadence: CadenceKind.DAILY,
  cronExpression: null,
  shiftDurationHours: 24,
  handoverOffsetMinutes: 0,
  confirmationDueHours: 24,
  reminderLeadHours: [] as number[],
  timezone: "Asia/Ho_Chi_Minh",
};

const p3 = [{ userId: "A" }, { userId: "B" }, { userId: "C" }];
const p4 = [{ userId: "A" }, { userId: "B" }, { userId: "C" }, { userId: "D" }];

const TZ = "Asia/Ho_Chi_Minh";

function localParts(date: Date) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: parts.hour };
}

function show(label: string, slots: object[], participants: { userId: string }[], days = 7) {
  // rangeStart aligned to local midnight to avoid partial-day slots
  const start = new Date("2026-05-01T17:00:00Z"); // = 2026-05-02 00:00 Ho Chi Minh
  const end = new Date(start.getTime() + days * 86400_000);
  const shifts = generateShifts(
    { ...base, timeSlots: slots as any },
    participants,
    start,
    end
  );
  console.log("\n==", label, "==");
  const byDay = new Map<string, { a: string; hour: string }[]>();
  for (const s of shifts) {
    const { day, hour } = localParts(s.startsAt);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push({ a: s.assigneeId, hour });
  }
  for (const [d, ss] of [...byDay.entries()].sort()) {
    const row = ss
      .sort((x, y) => x.hour.localeCompare(y.hour))
      .map((x) => `${x.hour}h:${x.a}`)
      .join("  ");
    console.log(d, row);
  }
}

// Scenario 1: 2 slots, 3 people
show("2 ca (8-20h, 20-8h qua dem) / 3 nguoi", [
  { label: "Ngay", startHour: 8, startMinute: 0, endHour: 20, endMinute: 0 },
  { label: "Dem",  startHour: 20, startMinute: 0, endHour: 8, endMinute: 0 },
], p3);

// Scenario 2: 3 slots, 3 people
show("3 ca (0-8h, 8-16h, 16-24h) / 3 nguoi  [rest-day rule TAT - can < 4]", [
  { label: "Dem",   startHour: 0,  startMinute: 0, endHour: 8,  endMinute: 0 },
  { label: "Sang",  startHour: 8,  startMinute: 0, endHour: 16, endMinute: 0 },
  { label: "Chieu", startHour: 16, startMinute: 0, endHour: 24, endMinute: 0 },
], p3);

// Scenario 3: 3 slots, 4 people (rest-day rule ON)
show("3 ca (0-8h, 8-16h, 16-24h) / 4 nguoi  [rest-day rule BAT]", [
  { label: "Dem",   startHour: 0,  startMinute: 0, endHour: 8,  endMinute: 0 },
  { label: "Sang",  startHour: 8,  startMinute: 0, endHour: 16, endMinute: 0 },
  { label: "Chieu", startHour: 16, startMinute: 0, endHour: 24, endMinute: 0 },
], p4, 9);
