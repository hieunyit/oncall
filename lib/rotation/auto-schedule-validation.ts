import { localDayKey, localDayKeysForWindow } from "@/lib/rotation/engine";

type ShiftWindow = {
  id?: string;
  policyId?: string;
  assigneeId: string;
  startsAt: Date;
  endsAt: Date;
};

type ValidationInput = {
  generatedShifts: ShiftWindow[];
  existingShifts: ShiftWindow[];
  timezone: string;
  ignoreExistingShiftIds?: string[];
};

export type AutoScheduleViolation = {
  code: string;
  message: string;
};

type PruneResult = {
  shifts: ShiftWindow[];
  dropped: number;
};

function overlaps(a: { startsAt: Date; endsAt: Date }, b: { startsAt: Date; endsAt: Date }): boolean {
  return a.startsAt < b.endsAt && a.endsAt > b.startsAt;
}

function hasSharedLocalDay(
  a: { startsAt: Date; endsAt: Date },
  b: { startsAt: Date; endsAt: Date },
  tz: string
): boolean {
  const aDays = new Set(localDayKeysForWindow(a.startsAt, a.endsAt, tz));
  return localDayKeysForWindow(b.startsAt, b.endsAt, tz).some((day) => aDays.has(day));
}

export function validateAutoScheduleOneShiftPerDay(input: ValidationInput): AutoScheduleViolation | null {
  const tz = input.timezone;

  // Generated shifts must not share any touched local day for the same user.
  const seenGenerated = new Map<string, ShiftWindow>();
  for (const shift of input.generatedShifts) {
    const touchedDays = localDayKeysForWindow(shift.startsAt, shift.endsAt, tz);
    for (const day of touchedDays) {
      const key = `${shift.assigneeId}|${day}`;
      if (seenGenerated.has(key)) {
        return {
          code: "AUTO_SAME_DAY_DUPLICATE",
          message: `Khong the chia lich tu dong: ${shift.assigneeId} co hon 1 ca trong ngay ${day}.`,
        };
      }
      seenGenerated.set(key, shift);
    }
  }

  const ignoreSet = new Set(input.ignoreExistingShiftIds ?? []);
  const existingByAssignee = new Map<string, ShiftWindow[]>();
  for (const shift of input.existingShifts) {
    if (shift.id && ignoreSet.has(shift.id)) continue;
    const list = existingByAssignee.get(shift.assigneeId) ?? [];
    list.push(shift);
    existingByAssignee.set(shift.assigneeId, list);
  }

  for (const generated of input.generatedShifts) {
    const generatedDays = localDayKeysForWindow(generated.startsAt, generated.endsAt, tz);
    const firstGeneratedDay = generatedDays[0] ?? localDayKey(generated.startsAt, tz);
    const sameUserExisting = existingByAssignee.get(generated.assigneeId) ?? [];

    for (const existing of sameUserExisting) {
      if (overlaps(existing, generated) || hasSharedLocalDay(existing, generated, tz)) {
        return {
          code: "AUTO_CONFLICT_EXISTING_SHIFT",
          message: `Khong the chia lich tu dong: ${generated.assigneeId} da co ca khac trong ngay ${firstGeneratedDay}.`,
        };
      }
    }
  }

  return null;
}

export function pruneAutoScheduleConflicts(input: ValidationInput): PruneResult {
  const tz = input.timezone;
  const ignoreSet = new Set(input.ignoreExistingShiftIds ?? []);

  const existingByAssignee = new Map<string, ShiftWindow[]>();
  const existingDayKeys = new Set<string>();

  for (const shift of input.existingShifts) {
    if (shift.id && ignoreSet.has(shift.id)) continue;

    for (const day of localDayKeysForWindow(shift.startsAt, shift.endsAt, tz)) {
      existingDayKeys.add(`${shift.assigneeId}|${day}`);
    }

    const list = existingByAssignee.get(shift.assigneeId) ?? [];
    list.push(shift);
    existingByAssignee.set(shift.assigneeId, list);
  }

  const generatedSeenDay = new Set<string>();
  const sorted = [...input.generatedShifts].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const accepted: ShiftWindow[] = [];

  for (const shift of sorted) {
    const shiftDayKeys = localDayKeysForWindow(shift.startsAt, shift.endsAt, tz).map(
      (day) => `${shift.assigneeId}|${day}`
    );

    if (shiftDayKeys.some((key) => generatedSeenDay.has(key))) continue;
    if (shiftDayKeys.some((key) => existingDayKeys.has(key))) continue;

    const sameUserExisting = existingByAssignee.get(shift.assigneeId) ?? [];
    const hasOverlap = sameUserExisting.some((existing) => overlaps(existing, shift));
    if (hasOverlap) continue;

    for (const key of shiftDayKeys) {
      generatedSeenDay.add(key);
    }
    accepted.push(shift);
  }

  return {
    shifts: accepted,
    dropped: input.generatedShifts.length - accepted.length,
  };
}
