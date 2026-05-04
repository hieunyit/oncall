import {
  generateShifts,
  GeneratedShift,
  OccupiedMap,
  ParticipantSlot,
  PolicyConfig,
  PriorState,
  localDayKeysForWindow,
} from "@/lib/rotation/engine";
import { validateAutoScheduleOneShiftPerDay } from "@/lib/rotation/auto-schedule-validation";
import { AUTO_SCHEDULE_WARNING_MESSAGE } from "@/lib/rotation/auto-schedule-warning";

type ShiftWindow = {
  id?: string;
  policyId?: string;
  assigneeId: string;
  startsAt: Date;
  endsAt: Date;
};

export type AutoScheduleWarning = {
  code: "AUTO_SCHEDULE_INSUFFICIENT_PEOPLE";
  message: string;
  affectedShifts: number;
  attemptErrors: string[];
};

export type AutoScheduledShift = GeneratedShift & {
  hasWarning?: boolean;
};

export type AutoScheduleGenerationResult = {
  shifts: AutoScheduledShift[];
  warning: AutoScheduleWarning | null;
};

export function buildOccupiedMapFromShifts(
  shifts: ShiftWindow[],
  ignoreShiftIds: Set<string> = new Set()
): OccupiedMap {
  const occupied: OccupiedMap = new Map();

  for (const shift of shifts) {
    if (shift.id && ignoreShiftIds.has(shift.id)) continue;
    const list = occupied.get(shift.assigneeId) ?? [];
    list.push({
      policyId: shift.policyId ?? "unknown",
      startsAt: shift.startsAt,
      endsAt: shift.endsAt,
    });
    occupied.set(shift.assigneeId, list);
  }

  return occupied;
}

type GenerateAutoShiftsWithoutConflictInput = {
  policy: PolicyConfig;
  policyId?: string;
  participants: ParticipantSlot[];
  rangeStart: Date;
  rangeEnd: Date;
  startingIndex: number;
  timezone: string;
  occupied: OccupiedMap;
  existingShifts: ShiftWindow[];
  ignoreExistingShiftIds?: string[];
  priorState?: PriorState;
  filterStartsAtGte?: Date;
};

function overlaps(a: { startsAt: Date; endsAt: Date }, b: { startsAt: Date; endsAt: Date }): boolean {
  return a.startsAt < b.endsAt && a.endsAt > b.startsAt;
}

function hasSharedLocalDay(
  a: { startsAt: Date; endsAt: Date },
  b: { startsAt: Date; endsAt: Date },
  timezone: string
): boolean {
  const aDays = new Set(localDayKeysForWindow(a.startsAt, a.endsAt, timezone));
  return localDayKeysForWindow(b.startsAt, b.endsAt, timezone).some((day) => aDays.has(day));
}

function collectRelaxedWarningIndices(
  generatedShifts: GeneratedShift[],
  existingShifts: ShiftWindow[],
  timezone: string,
  ignoreExistingShiftIds?: string[]
): Set<number> {
  const warningIndices = new Set<number>();
  const ignoreSet = new Set(ignoreExistingShiftIds ?? []);

  const existingByAssignee = new Map<string, ShiftWindow[]>();
  for (const shift of existingShifts) {
    if (shift.id && ignoreSet.has(shift.id)) continue;
    const list = existingByAssignee.get(shift.assigneeId) ?? [];
    list.push(shift);
    existingByAssignee.set(shift.assigneeId, list);
  }

  const generatedByAssignee = new Map<string, Array<{ shift: GeneratedShift; index: number }>>();
  const orderedGenerated = generatedShifts
    .map((shift, index) => ({ shift, index }))
    .sort((a, b) => a.shift.startsAt.getTime() - b.shift.startsAt.getTime());

  for (const item of orderedGenerated) {
    const generated = item.shift;
    const existingForAssignee = existingByAssignee.get(generated.assigneeId) ?? [];

    for (const existing of existingForAssignee) {
      if (overlaps(existing, generated) || hasSharedLocalDay(existing, generated, timezone)) {
        warningIndices.add(item.index);
        break;
      }
    }

    const priorForAssignee = generatedByAssignee.get(generated.assigneeId) ?? [];
    for (const prior of priorForAssignee) {
      if (overlaps(prior.shift, generated) || hasSharedLocalDay(prior.shift, generated, timezone)) {
        warningIndices.add(item.index);
        warningIndices.add(prior.index);
      }
    }

    priorForAssignee.push({ shift: generated, index: item.index });
    generatedByAssignee.set(generated.assigneeId, priorForAssignee);
  }

  return warningIndices;
}

export function generateAutoShiftsWithoutConflict(
  input: GenerateAutoShiftsWithoutConflictInput
): AutoScheduleGenerationResult {
  if (input.participants.length === 0) {
    return { shifts: [], warning: null };
  }

  const attempts = input.participants.length;
  const attemptErrors: string[] = [];

  for (let offset = 0; offset < attempts; offset++) {
    const startingIndex = (input.startingIndex + offset) % input.participants.length;

    try {
      const generated = generateShifts(
        input.policy,
        input.participants,
        input.rangeStart,
        input.rangeEnd,
        startingIndex,
        {
          policyId: input.policyId,
          occupied: input.occupied,
          priorState: input.priorState,
          strictAssignment: true,
        }
      );

      const filterStartsAtGte = input.filterStartsAtGte;
      const filtered = filterStartsAtGte
        ? generated.filter((s) => s.startsAt >= filterStartsAtGte)
        : generated;

      const violation = validateAutoScheduleOneShiftPerDay({
        generatedShifts: filtered.map((s) => ({
          assigneeId: s.assigneeId,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
        })),
        existingShifts: input.existingShifts,
        timezone: input.timezone,
        ignoreExistingShiftIds: input.ignoreExistingShiftIds,
      });

      if (!violation) {
        return {
          shifts: filtered,
          warning: null,
        };
      }

      attemptErrors.push(violation.code);
    } catch (error) {
      if (error instanceof Error) {
        attemptErrors.push(error.message);
      }
    }
  }

  let bestFallback: { shifts: GeneratedShift[]; warningIndices: Set<number> } | null = null;

  for (let offset = 0; offset < attempts; offset++) {
    const startingIndex = (input.startingIndex + offset) % input.participants.length;

    try {
      const generated = generateShifts(
        input.policy,
        input.participants,
        input.rangeStart,
        input.rangeEnd,
        startingIndex,
        {
          policyId: input.policyId,
          occupied: input.occupied,
          priorState: input.priorState,
          strictAssignment: false,
        }
      );

      const filterStartsAtGte = input.filterStartsAtGte;
      const filtered = filterStartsAtGte
        ? generated.filter((s) => s.startsAt >= filterStartsAtGte)
        : generated;

      const warningIndices = collectRelaxedWarningIndices(
        filtered,
        input.existingShifts,
        input.timezone,
        input.ignoreExistingShiftIds
      );
      const effectiveWarningIndices =
        warningIndices.size > 0
          ? warningIndices
          : new Set(filtered.map((_, index) => index));

      if (
        !bestFallback ||
        effectiveWarningIndices.size < bestFallback.warningIndices.size
      ) {
        bestFallback = { shifts: filtered, warningIndices: effectiveWarningIndices };
      }
    } catch (error) {
      if (error instanceof Error) {
        attemptErrors.push(error.message);
      }
    }
  }

  if (!bestFallback) {
    throw new Error(
      `AUTO_SCHEDULE_UNASSIGNABLE:${attemptErrors.join(",") || "NO_ELIGIBLE_MEMBER"}`
    );
  }

  const fallback = bestFallback;

  return {
    shifts: fallback.shifts.map((shift, index) => ({
      ...shift,
      hasWarning: fallback.warningIndices.has(index),
    })),
    warning: {
      code: "AUTO_SCHEDULE_INSUFFICIENT_PEOPLE",
      message: AUTO_SCHEDULE_WARNING_MESSAGE,
      affectedShifts: fallback.warningIndices.size,
      attemptErrors,
    },
  };
}
