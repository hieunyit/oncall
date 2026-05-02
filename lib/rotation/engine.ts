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
 * a person cannot have overlapping shifts OR two shifts on the same calendar day
 * from two different policies in the same team.
 */
export type OccupiedMap = Map<string, Array<{ policyId: string; startsAt: Date; endsAt: Date }>>;

/**
 * Prior assignment state carried into generateShifts when regenerating from a mid-range date.
 * Allows the engine to honour consecutive-shift and rest-day rules across the cutoff boundary.
 */
export interface PriorState {
  previousAssigneeId?: string | null;
  previousNightAssigneeId?: string | null;

  /**
   * Who did a midnight/overnight rest-rule shift on the day immediately before rangeStart.
   * Rule: they must not work on rangeStart day.
   */
  lastNightAssigneeId?: string | null;

  /**
   * Who did a midnight/overnight rest-rule shift two days before rangeStart.
   * Rule: they may work on rangeStart day, but should avoid midnight/overnight slots if enough people exist.
   */
  twoAgoNightAssigneeId?: string | null;
}

/** Local YYYY-MM-DD key for a Date in the given timezone. */
export function localDayKey(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Returns true when a generated shift qualifies as a midnight/overnight shift.
 *
 * This function is kept exported because other parts of the app may already import it.
 * The previous version treated startHour >= 18 as night.
 * For the requirement in this file, the rest rule is only about:
 * - slots crossing midnight; or
 * - slots starting from 00:00 to before 06:00.
 */
export function isNightShiftTime(startsAt: Date, endsAt: Date, tz: string): boolean {
  const startHour = parseInt(
    new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(startsAt),
    10
  );

  const overnight = localDayKey(startsAt, tz) !== localDayKey(endsAt, tz);

  return overnight || startHour < 6;
}

/**
 * Returns true for slots that trigger the special rest rule:
 *
 * Day D:
 *   Person A works a slot that crosses midnight, or starts at 00:00-05:59.
 *
 * Day D+1:
 *   Person A must not work any slot.
 *
 * Day D+2:
 *   Person A may work again, but should not work another midnight/overnight slot
 *   if there are enough other people to assign that slot.
 */
function isRestRuleSlot(slot: TimeSlot, overnight: boolean): boolean {
  return overnight || slot.startHour < 6;
}

function overlaps(a: { startsAt: Date; endsAt: Date }, b: { startsAt: Date; endsAt: Date }): boolean {
  return a.startsAt < b.endsAt && a.endsAt > b.startsAt;
}

interface AssignmentState {
  assignedCounts: Map<string, number>;
  nightCounts: Map<string, number>;

  /**
   * Last assigned person for any slot.
   * Used to reduce consecutive assignments.
   */
  previousAssigneeId: string | null;

  /**
   * Last assigned person for a rest-rule slot.
   * Used to reduce consecutive midnight/overnight assignments.
   */
  previousNightAssigneeId: string | null;

  /**
   * Last assigned person for the last slot of the day when that slot is not a rest-rule slot.
   * Used to reduce consecutive late slots.
   */
  previousLateAssigneeId: string | null;

  /**
   * People already assigned on the current calendar day.
   * Used to avoid assigning the same person twice in one day within this policy.
   */
  assignedToday: Set<string>;

  /**
   * Person who worked a rest-rule slot yesterday.
   * They should not work today.
   */
  lastNightAssigneeId: string | null;

  /**
   * Person who worked a rest-rule slot two days ago.
   * They may work today, but should avoid a rest-rule slot if enough people exist.
   */
  twoAgoNightAssigneeId: string | null;
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
  occupied: OccupiedMap,
  tz: string
): boolean {
  if (!currentPolicyId) return false;

  const slotDay = localDayKey(slot.startsAt, tz);

  return (occupied.get(userId) ?? []).some(
    (o) =>
      o.policyId !== currentPolicyId &&
      // Time overlap OR same calendar day.
      // The same person should not work two policies on the same local calendar day.
      (overlaps(o, slot) || localDayKey(o.startsAt, tz) === slotDay)
  );
}

function selectParticipant(
  participants: ParticipantSlot[],
  preferredIdx: number,
  slot: { startsAt: Date; endsAt: Date },

  /**
   * True for rest-rule slots:
   * - overnight slots; or
   * - slots starting from 00:00 to before 06:00.
   */
  isNightForRestRule: boolean,

  /**
   * True for the last slot of the day when that slot is not a rest-rule slot.
   */
  isLateButNotNight: boolean,

  currentPolicyId: string | undefined,
  occupied: OccupiedMap,
  state: AssignmentState,
  tz: string,

  /**
   * Hard excludes:
   * - rest day after a midnight/overnight slot yesterday;
   * - already assigned today.
   *
   * This exclusion is strong. It should only be relaxed when there is literally
   * no other candidate in the current cross-policy pool.
   */
  hardExclude: Set<string>,

  /**
   * Night-only excludes:
   * - D+2 rule: person who worked a midnight/overnight slot two days ago
   *   should avoid another midnight/overnight slot today if enough people exist.
   *
   * This exclusion is soft. It can be relaxed if not enough people exist.
   */
  nightHardExclude: Set<string>
): ParticipantSlot {
  const ordered = getOrderedIndices(participants.length, preferredIdx);

  // Step 1: Prefer people without cross-policy conflicts.
  const noCrossConflict = ordered.filter(
    (idx) => !hasCrossPolicyConflict(participants[idx].userId, slot, currentPolicyId, occupied, tz)
  );

  // If everyone conflicts with other policies, fall back to the original ordered pool.
  const crossPool = noCrossConflict.length > 0 ? noCrossConflict : ordered;

  /**
   * Step 2A: Apply hard excludes first.
   *
   * Important:
   * The previous implementation combined hardExclude and nightHardExclude, then
   * fell back directly to crossPool. That could accidentally assign someone on
   * their mandatory rest day.
   *
   * New behavior:
   * - hardExclude is relaxed only if every candidate is excluded.
   * - nightHardExclude is relaxed more easily because the requirement says
   *   "avoid the 0h slot on D+2 if there are enough people".
   */
  const withoutHardExclude = crossPool.filter((idx) => {
    const uid = participants[idx].userId;
    return !hardExclude.has(uid);
  });

  const hardPool = withoutHardExclude.length > 0 ? withoutHardExclude : crossPool;

  // Step 2B: Apply night-only excludes after hard excludes.
  const withoutNightExclude = hardPool.filter((idx) => {
    const uid = participants[idx].userId;
    return !nightHardExclude.has(uid);
  });

  // If everyone is excluded only by the D+2 night rule, relax that rule.
  const pool = withoutNightExclude.length > 0 ? withoutNightExclude : hardPool;

  const previousAssigneeId = state.previousAssigneeId;
  const previousNightAssigneeId = state.previousNightAssigneeId;
  const previousLateAssigneeId = state.previousLateAssigneeId;

  /**
   * Priority tiers:
   *
   * tier0:
   *   Avoid consecutive assignment and also avoid consecutive midnight/overnight
   *   or consecutive late slot.
   *
   * tier1:
   *   Avoid consecutive assignment only.
   *
   * tier2:
   *   Avoid consecutive midnight/overnight or consecutive late slot only.
   *
   * fallback:
   *   Any candidate in the current pool.
   */
  const tier0 = pool.filter((idx) => {
    const uid = participants[idx].userId;
    const noConsec = participants.length <= 1 || uid !== previousAssigneeId;
    const noNight = !isNightForRestRule || participants.length <= 1 || uid !== previousNightAssigneeId;
    const noLate = !isLateButNotNight || participants.length <= 1 || uid !== previousLateAssigneeId;

    return noConsec && noNight && noLate;
  });

  const tier1 = pool.filter(
    (idx) => participants.length <= 1 || participants[idx].userId !== previousAssigneeId
  );

  const tier2 = pool.filter((idx) => {
    const uid = participants[idx].userId;
    const noNight = !isNightForRestRule || participants.length <= 1 || uid !== previousNightAssigneeId;
    const noLate = !isLateButNotNight || participants.length <= 1 || uid !== previousLateAssigneeId;

    return noNight && noLate;
  });

  const candidates =
    tier0.length > 0 ? tier0 : tier1.length > 0 ? tier1 : tier2.length > 0 ? tier2 : pool;

  /**
   * Among candidates:
   * 1. Prefer the person with the lowest total assignment count.
   * 2. For midnight/overnight slots, prefer the person with the lowest midnight/overnight count.
   * 3. Prefer the person closest to the rotation order.
   * 4. Use userId lexical order as a deterministic tie-breaker.
   */
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

    if (isNightForRestRule) {
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

function recordAssignment(
  state: AssignmentState,
  assigneeId: string,
  isNightForRestRule: boolean,
  isLateButNotNight: boolean
) {
  state.assignedCounts.set(assigneeId, getCount(state.assignedCounts, assigneeId) + 1);
  state.previousAssigneeId = assigneeId;
  state.assignedToday.add(assigneeId);

  if (isNightForRestRule) {
    state.nightCounts.set(assigneeId, getCount(state.nightCounts, assigneeId) + 1);
    state.previousNightAssigneeId = assigneeId;
  } else if (isLateButNotNight) {
    state.previousLateAssigneeId = assigneeId;
  }
}

/** Build a TZDate for a specific calendar day + hour:minute in the given timezone. */
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
    priorState?: PriorState;
  }
): GeneratedShift[] {
  if (participants.length === 0) return [];

  // Prevent invalid or empty ranges from causing date-fns interval errors.
  if (!isBefore(rangeStart, rangeEnd)) return [];

  const shifts: GeneratedShift[] = [];
  let idx = startingIndex % participants.length;

  const tz = policy.timezone ?? "Asia/Ho_Chi_Minh";
  const policyId = options?.policyId;
  const occupied = options?.occupied ?? new Map();
  const prior = options?.priorState ?? {};

  const state: AssignmentState = {
    assignedCounts: new Map(),
    nightCounts: new Map(),
    previousAssigneeId: prior.previousAssigneeId ?? null,
    previousNightAssigneeId: prior.previousNightAssigneeId ?? null,
    previousLateAssigneeId: null,
    assignedToday: new Set(),
    lastNightAssigneeId: prior.lastNightAssigneeId ?? null,
    twoAgoNightAssigneeId: prior.twoAgoNightAssigneeId ?? null,
  };

  function applyHandover(rawEnd: Date): Date {
    return policy.handoverOffsetMinutes !== 0
      ? new Date(rawEnd.getTime() + policy.handoverOffsetMinutes * 60_000)
      : rawEnd;
  }

  /**
   * Time-slot mode.
   *
   * This mode supports multiple slots per day and applies the special rest rule:
   *
   * Day D:
   *   A works a rest-rule slot.
   *
   * Day D+1:
   *   A should not work any slot.
   *
   * Day D+2:
   *   A may work again, but should avoid another rest-rule slot if enough people exist.
   */
  if (policy.timeSlots && policy.timeSlots.length > 0) {
    const days = eachDayOfInterval({ start: rangeStart, end: subDays(rangeEnd, 1) });

    // Move preferred base by 1 per day so everyone rotates through slot types.
    let dayBaseIdx = startingIndex % participants.length;

    /**
     * Rest-day and D+2 rules are useful only when there are enough people and enough slots.
     * Keeping this condition avoids over-constraining very small teams.
     */
    const applyRestRule = participants.length >= 4 && policy.timeSlots.length >= 3;

    for (const day of days) {
      const dow = day.getUTCDay();

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

      // Reset same-day tracking at the start of each local schedule day.
      state.assignedToday = new Set();

      /**
       * hardExclude:
       *   Person who worked a rest-rule slot yesterday cannot work today.
       */
      const restDayExclude: Set<string> = new Set();

      if (applyRestRule && state.lastNightAssigneeId) {
        restDayExclude.add(state.lastNightAssigneeId);
      }

      /**
       * nightHardExclude:
       *   Person who worked a rest-rule slot two days ago should avoid a rest-rule slot today
       *   if enough people exist.
       */
      const nightHardExclude: Set<string> = new Set();

      if (applyRestRule && state.twoAgoNightAssigneeId) {
        nightHardExclude.add(state.twoAgoNightAssigneeId);
      }

      // Track who works today's rest-rule slot so the state can roll forward after the day ends.
      let dayNightAssigneeId: string | null = null;

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

        // Skip slots that start before the requested rangeStart.
        if (isBefore(startsAt, rangeStart)) continue;

        // Stop if the slot starts after the requested rangeEnd.
        if (!isBefore(startsAt, rangeEnd)) break;

        // Skip slots that would end after the requested rangeEnd.
        if (isAfter(endsAt, rangeEnd)) continue;

        const isNightForRestRule = isRestRuleSlot(slot, overnight);
        const isLateButNotNight = !isNightForRestRule && slotI === lateSlotIndex;

        const preferredIdx = (dayBaseIdx + slotI) % participants.length;

        /**
         * Combine:
         * - rest-day exclusion from yesterday's rest-rule slot;
         * - already-assigned-today exclusion.
         */
        const currentHardExclude = new Set(restDayExclude);

        for (const uid of state.assignedToday) {
          currentHardExclude.add(uid);
        }

        /**
         * Apply D+2 night exclusion only on rest-rule slots.
         * On normal slots, the person can work again on D+2.
         */
        const effectiveNightExclude = isNightForRestRule ? nightHardExclude : new Set<string>();

        const participant = selectParticipant(
          participants,
          preferredIdx,
          { startsAt, endsAt },
          isNightForRestRule,
          isLateButNotNight,
          policyId,
          occupied,
          state,
          tz,
          currentHardExclude,
          effectiveNightExclude
        );

        shifts.push({
          assigneeId: participant.userId,
          backupId: participant.backupId,
          startsAt,
          endsAt,
        });

        recordAssignment(state, participant.userId, isNightForRestRule, isLateButNotNight);

        if (isNightForRestRule) {
          dayNightAssigneeId = participant.userId;
        }
      }

      /**
       * Roll rest-rule state forward by one day:
       *
       * Before:
       *   lastNightAssigneeId = person from yesterday
       *   twoAgoNightAssigneeId = person from two days ago
       *
       * After:
       *   twoAgoNightAssigneeId = old yesterday person
       *   lastNightAssigneeId = today's rest-rule person
       */
      state.twoAgoNightAssigneeId = state.lastNightAssigneeId;
      state.lastNightAssigneeId = dayNightAssigneeId;

      dayBaseIdx = (dayBaseIdx + 1) % participants.length;
    }

    return shifts;
  }

  /**
   * CUSTOM_CRON mode.
   *
   * Important loop fix:
   *   Do not call cron.nextRun(startsAt), because some cron implementations may
   *   return the same timestamp again depending on inclusivity.
   *
   * Use startsAt + 1ms and also guard against non-advancing timestamps.
   */
  if (policy.cadence === CadenceKind.CUSTOM_CRON) {
    if (!policy.cronExpression) return shifts;

    const cron = new Cron(policy.cronExpression, { timezone: tz });
    let next = cron.nextRun(new Date(rangeStart.getTime() - 1));

    let lastNextTime = Number.NEGATIVE_INFINITY;

    while (next && isBefore(next, rangeEnd)) {
      const nextTime = next.getTime();

      if (nextTime <= lastNextTime) {
        throw new Error("Cron nextRun did not advance; possible infinite loop");
      }

      lastNextTime = nextTime;

      const startsAt = new Date(next);
      const endsAt = applyHandover(addHours(startsAt, policy.shiftDurationHours));

      if (isBefore(startsAt, rangeStart)) {
        next = cron.nextRun(new Date(startsAt.getTime() + 1));
        continue;
      }

      if (isAfter(endsAt, rangeEnd)) break;

      const participant = selectParticipant(
        participants,
        idx,
        { startsAt, endsAt },
        false,
        false,
        policyId,
        occupied,
        state,
        tz,
        new Set(),
        new Set()
      );

      shifts.push({
        assigneeId: participant.userId,
        backupId: participant.backupId,
        startsAt,
        endsAt,
      });

      recordAssignment(state, participant.userId, false, false);

      idx = (idx + 1) % participants.length;

      // Critical loop fix: move the cursor forward by at least 1ms.
      next = cron.nextRun(new Date(startsAt.getTime() + 1));
    }

    return shifts;
  }

  /**
   * DAILY / WEEKLY cadence mode.
   *
   * current always moves forward by one day or one week, so this branch should not loop forever.
   */
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
      false,
      policyId,
      occupied,
      state,
      tz,
      new Set(),
      new Set()
    );

    shifts.push({
      assigneeId: participant.userId,
      backupId: participant.backupId,
      startsAt,
      endsAt,
    });

    recordAssignment(state, participant.userId, false, false);

    idx = (idx + 1) % participants.length;

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
