import { addHours, addDays, addWeeks, isAfter, isBefore, eachDayOfInterval, subDays } from "date-fns";
import { TZDate } from "@date-fns/tz";
import { Cron } from "croner";
import { CadenceKind } from "@/app/generated/prisma/client";

export interface TimeSlot {
  label: string;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  daysOfWeek?: number[]; // 0=Sun,1=Mon,...,6=Sat; empty/absent = all days
}

export interface PolicyConfig {
  cadence: CadenceKind;
  cronExpression?: string | null;
  shiftDurationHours: number;
  handoverOffsetMinutes: number;
  confirmationDueHours: number;
  reminderLeadHours: number[];
  timeSlots?: TimeSlot[] | null;
  timezone?: string | null;
}

export interface ParticipantSlot {
  userId: string;
  backupId?: string;
}

export interface GeneratedShift {
  assigneeId: string;
  backupId?: string;
  startsAt: Date;
  endsAt: Date;
}

/**
 * Map of userId -> list of existing shifts from OTHER policies that belong to the same team.
 * Used to skip participants who would violate the cross-policy constraint:
 * a person cannot have overlapping shifts from two different policies in the same team.
 */
export type OccupiedMap = Map<string, Array<{ policyId: string; startsAt: Date; endsAt: Date }>>;

function overlaps(a: { startsAt: Date; endsAt: Date }, b: { startsAt: Date; endsAt: Date }): boolean {
  return a.startsAt < b.endsAt && a.endsAt > b.startsAt;
}

interface AssignmentState {
  assignedCounts: Map<string, number>;
  nightCounts: Map<string, number>;
  previousAssigneeId: string | null;
  previousNightAssigneeId: string | null;
}

function getCount(map: Map<string, number>, userId: string): number {
  return map.get(userId) ?? 0;
}

function getOrderedIndices(length: number, startIdx: number): number[] {
  return Array.from({ length }, (_, i) => (startIdx + i) % length);
}

function hasCrossPolicyConflict(
  userId: string,
  slot: { startsAt: Date; endsAt: Date },
  currentPolicyId: string | undefined,
  occupied: OccupiedMap
): boolean {
  if (!currentPolicyId) return false;
  return (occupied.get(userId) ?? []).some(
    (o) => o.policyId !== currentPolicyId && overlaps(o, slot)
  );
}

function selectParticipant(
  participants: ParticipantSlot[],
  preferredIdx: number,
  slot: { startsAt: Date; endsAt: Date },
  isNightShift: boolean,
  currentPolicyId: string | undefined,
  occupied: OccupiedMap,
  state: AssignmentState
): ParticipantSlot {
  const ordered = getOrderedIndices(participants.length, preferredIdx);

  const noConflict = ordered.filter(
    (idx) =>
      !hasCrossPolicyConflict(
        participants[idx].userId,
        slot,
        currentPolicyId,
        occupied
      )
  );

  // If everyone conflicts with another policy, we still keep scheduling as fallback.
  const pool = noConflict.length > 0 ? noConflict : ordered;

  const previousAssigneeId = state.previousAssigneeId;
  const previousNightAssigneeId = state.previousNightAssigneeId;

  // Priority tiers:
  // 1) avoid consecutive shifts + avoid consecutive night shifts
  // 2) avoid consecutive shifts
  // 3) avoid consecutive night shifts
  // 4) fallback to any candidate
  const tier0 = pool.filter((idx) => {
    const userId = participants[idx].userId;
    return (
      (participants.length <= 1 || userId !== previousAssigneeId) &&
      (!isNightShift || participants.length <= 1 || userId !== previousNightAssigneeId)
    );
  });
  const tier1 = pool.filter(
    (idx) =>
      participants.length <= 1 ||
      participants[idx].userId !== previousAssigneeId
  );
  const tier2 = pool.filter(
    (idx) =>
      !isNightShift ||
      participants.length <= 1 ||
      participants[idx].userId !== previousNightAssigneeId
  );

  const candidates =
    tier0.length > 0
      ? tier0
      : tier1.length > 0
        ? tier1
        : tier2.length > 0
          ? tier2
          : pool;

  // Among candidates, choose "most balanced" first, then closest to preferred rotation order.
  let bestIdx = candidates[0];
  for (const idx of candidates.slice(1)) {
    const currentId = participants[idx].userId;
    const bestId = participants[bestIdx].userId;

    const currentAssigned = getCount(state.assignedCounts, currentId);
    const bestAssigned = getCount(state.assignedCounts, bestId);
    if (currentAssigned !== bestAssigned) {
      if (currentAssigned < bestAssigned) bestIdx = idx;
      continue;
    }

    if (isNightShift) {
      const currentNight = getCount(state.nightCounts, currentId);
      const bestNight = getCount(state.nightCounts, bestId);
      if (currentNight !== bestNight) {
        if (currentNight < bestNight) bestIdx = idx;
        continue;
      }
    }

    const currentOrder = (idx - preferredIdx + participants.length) % participants.length;
    const bestOrder = (bestIdx - preferredIdx + participants.length) % participants.length;
    if (currentOrder !== bestOrder) {
      if (currentOrder < bestOrder) bestIdx = idx;
      continue;
    }

    if (currentId < bestId) {
      bestIdx = idx;
    }
  }

  return participants[bestIdx];
}

function recordAssignment(state: AssignmentState, assigneeId: string, isNightShift: boolean) {
  state.assignedCounts.set(
    assigneeId,
    getCount(state.assignedCounts, assigneeId) + 1
  );
  state.previousAssigneeId = assigneeId;

  if (isNightShift) {
    state.nightCounts.set(
      assigneeId,
      getCount(state.nightCounts, assigneeId) + 1
    );
    state.previousNightAssigneeId = assigneeId;
  }
}

/** Build a TZDate for a specific calendar day + hour:minute in the given timezone */
function tzDateTime(
  day: Date, // treated as UTC calendar date
  hour: number,
  minute: number,
  tz: string
): Date {
  const d = new TZDate(
    day.getUTCFullYear(),
    day.getUTCMonth(),
    day.getUTCDate(),
    hour,
    minute,
    0,
    0,
    tz
  );
  return new Date(d.getTime());
}

export function generateShifts(
  policy: PolicyConfig,
  participants: ParticipantSlot[],
  rangeStart: Date,
  rangeEnd: Date,
  startingIndex = 0,
  options?: {
    policyId?: string;
    occupied?: OccupiedMap;
  }
): GeneratedShift[] {
  if (participants.length === 0) return [];

  const shifts: GeneratedShift[] = [];
  let idx = startingIndex % participants.length;
  const tz = policy.timezone ?? "Asia/Ho_Chi_Minh";
  const policyId = options?.policyId;
  const occupied = options?.occupied ?? new Map();

  const state: AssignmentState = {
    assignedCounts: new Map(),
    nightCounts: new Map(),
    previousAssigneeId: null,
    previousNightAssigneeId: null,
  };

  function applyHandover(rawEnd: Date): Date {
    return policy.handoverOffsetMinutes !== 0
      ? new Date(rawEnd.getTime() + policy.handoverOffsetMinutes * 60_000)
      : rawEnd;
  }

  // Time-slot mode
  if (policy.timeSlots && policy.timeSlots.length > 0) {
    const days = eachDayOfInterval({ start: rangeStart, end: subDays(rangeEnd, 1) });

    // Move preferred base by 1 per day so everyone rotates through slot types.
    let dayBaseIdx = startingIndex % participants.length;

    for (const day of days) {
      const dow = day.getUTCDay(); // 0=Sun ... 6=Sat; UTC day to avoid server timezone drift
      const slotsForDay = policy.timeSlots
        .filter((s) => !s.daysOfWeek || s.daysOfWeek.length === 0 || s.daysOfWeek.includes(dow))
        .sort((a, b) => {
          const aStart = a.startHour * 60 + a.startMinute;
          const bStart = b.startHour * 60 + b.startMinute;
          if (aStart !== bStart) return aStart - bStart;
          const aEnd = a.endHour * 60 + a.endMinute;
          const bEnd = b.endHour * 60 + b.endMinute;
          return aEnd - bEnd;
        });
      if (slotsForDay.length === 0) continue;

      const lateSlotIndex = slotsForDay.length >= 2 ? slotsForDay.length - 1 : -1;

      for (let slotI = 0; slotI < slotsForDay.length; slotI++) {
        const slot = slotsForDay[slotI];
        const startsAt = tzDateTime(day, slot.startHour, slot.startMinute, tz);

        const rawEndsAt = tzDateTime(day, slot.endHour, slot.endMinute, tz);
        const overnight = rawEndsAt <= startsAt;
        let endsAt = rawEndsAt;

        if (overnight) {
          const nextDay = new Date(
            Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + 1)
          );
          endsAt = tzDateTime(nextDay, slot.endHour, slot.endMinute, tz);
        }

        if (isAfter(startsAt, rangeEnd)) break;

        const preferredIdx = (dayBaseIdx + slotI) % participants.length;
        const isNightShift = overnight || slotI === lateSlotIndex;

        const participant = selectParticipant(
          participants,
          preferredIdx,
          { startsAt, endsAt },
          isNightShift,
          policyId,
          occupied,
          state
        );

        shifts.push({
          assigneeId: participant.userId,
          backupId: participant.backupId,
          startsAt,
          endsAt,
        });

        recordAssignment(state, participant.userId, isNightShift);
      }

      dayBaseIdx = (dayBaseIdx + 1) % participants.length;
    }

    return shifts;
  }

  // CUSTOM_CRON mode
  if (policy.cadence === CadenceKind.CUSTOM_CRON) {
    if (!policy.cronExpression) return shifts;

    const cron = new Cron(policy.cronExpression, { timezone: tz });
    let next = cron.nextRun(new Date(rangeStart.getTime() - 1));

    while (next && isBefore(next, rangeEnd)) {
      const startsAt = new Date(next);
      const endsAt = applyHandover(addHours(startsAt, policy.shiftDurationHours));

      if (isAfter(endsAt, rangeEnd)) break;

      const participant = selectParticipant(
        participants,
        idx,
        { startsAt, endsAt },
        false,
        policyId,
        occupied,
        state
      );

      shifts.push({
        assigneeId: participant.userId,
        backupId: participant.backupId,
        startsAt,
        endsAt,
      });

      recordAssignment(state, participant.userId, false);
      idx++;
      next = cron.nextRun(startsAt);
    }

    return shifts;
  }

  // DAILY / WEEKLY cadence
  let current = rangeStart;

  while (isBefore(current, rangeEnd)) {
    const startsAt = new Date(current);
    const endsAt = applyHandover(addHours(startsAt, policy.shiftDurationHours));

    if (isAfter(endsAt, rangeEnd)) break;

    const participant = selectParticipant(
      participants,
      idx,
      { startsAt, endsAt },
      false,
      policyId,
      occupied,
      state
    );

    shifts.push({
      assigneeId: participant.userId,
      backupId: participant.backupId,
      startsAt,
      endsAt,
    });

    recordAssignment(state, participant.userId, false);
    idx++;

    current =
      policy.cadence === CadenceKind.DAILY
        ? addDays(startsAt, 1)
        : addWeeks(startsAt, 1);
  }

  return shifts;
}

export function computeConfirmationDueAt(
  shift: GeneratedShift,
  confirmationDueHours: number
): Date {
  return new Date(shift.startsAt.getTime() - confirmationDueHours * 60 * 60 * 1000);
}

export function computeReminderFireAt(
  shift: GeneratedShift,
  leadHours: number
): Date {
  return new Date(shift.startsAt.getTime() - leadHours * 60 * 60 * 1000);
}
