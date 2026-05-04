import { localDayKey } from "@/lib/rotation/engine";

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

export function validateAutoScheduleOneShiftPerDay(input: ValidationInput): AutoScheduleViolation | null {
  const tz = input.timezone;

  const seen = new Map<string, ShiftWindow>();
  for (const shift of input.generatedShifts) {
    const day = localDayKey(shift.startsAt, tz);
    const key = `${shift.assigneeId}|${day}`;
    const previous = seen.get(key);
    if (previous) {
      return {
        code: "AUTO_SAME_DAY_DUPLICATE",
        message: `Không thể chia lịch tự động: ${shift.assigneeId} có hơn 1 ca trong ngày ${day}.`,
      };
    }
    seen.set(key, shift);
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
    const day = localDayKey(generated.startsAt, tz);
    const sameUserExisting = existingByAssignee.get(generated.assigneeId) ?? [];
    for (const existing of sameUserExisting) {
      const existingDay = localDayKey(existing.startsAt, tz);
      if (existingDay === day || overlaps(existing, generated)) {
        return {
          code: "AUTO_CONFLICT_EXISTING_SHIFT",
          message: `Không thể chia lịch tự động: ${generated.assigneeId} đã có ca khác trong ngày ${day}.`,
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
    const day = localDayKey(shift.startsAt, tz);
    existingDayKeys.add(`${shift.assigneeId}|${day}`);
    const list = existingByAssignee.get(shift.assigneeId) ?? [];
    list.push(shift);
    existingByAssignee.set(shift.assigneeId, list);
  }

  const generatedSeenDay = new Set<string>();
  const sorted = [...input.generatedShifts].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const accepted: ShiftWindow[] = [];

  for (const shift of sorted) {
    const day = localDayKey(shift.startsAt, tz);
    const key = `${shift.assigneeId}|${day}`;
    if (generatedSeenDay.has(key)) continue;
    if (existingDayKeys.has(key)) continue;

    const sameUserExisting = existingByAssignee.get(shift.assigneeId) ?? [];
    let hasOverlap = false;
    for (const existing of sameUserExisting) {
      if (overlaps(existing, shift)) {
        hasOverlap = true;
        break;
      }
    }
    if (hasOverlap) continue;

    generatedSeenDay.add(key);
    accepted.push(shift);
  }

  return {
    shifts: accepted,
    dropped: input.generatedShifts.length - accepted.length,
  };
}
