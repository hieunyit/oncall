import {
  generateShifts,
  GeneratedShift,
  OccupiedMap,
  ParticipantSlot,
  PolicyConfig,
  PriorState,
} from "@/lib/rotation/engine";
import { validateAutoScheduleOneShiftPerDay } from "@/lib/rotation/auto-schedule-validation";

type ShiftWindow = {
  id?: string;
  policyId?: string;
  assigneeId: string;
  startsAt: Date;
  endsAt: Date;
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

export function generateAutoShiftsWithoutConflict(
  input: GenerateAutoShiftsWithoutConflictInput
): GeneratedShift[] {
  if (input.participants.length === 0) return [];

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
        return filtered;
      }

      attemptErrors.push(violation.code);
    } catch (error) {
      if (error instanceof Error) {
        attemptErrors.push(error.message);
      }
    }
  }

  throw new Error(
    `AUTO_SCHEDULE_UNASSIGNABLE:${attemptErrors.join(",") || "NO_ELIGIBLE_MEMBER"}`
  );
}
