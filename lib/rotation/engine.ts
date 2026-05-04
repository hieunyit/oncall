import { addHours, addDays, addWeeks, isAfter, isBefore } from "date-fns";
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
 * Map of userId -> list of existing occupied windows.
 * Used to skip participants who would violate scheduling constraints:
 * a person cannot have overlapping shifts OR two shifts on the same calendar day.
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
  lastNightAssigneeIds?: string[] | null;

  /**
   * Who did a midnight/overnight rest-rule shift two days before rangeStart.
   * Rule: they may work on rangeStart day, but should avoid midnight/overnight slots if enough people exist.
   */
  twoAgoNightAssigneeId?: string | null;
  twoAgoNightAssigneeIds?: string[] | null;
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
 * Returns all local calendar days touched by the shift interval [startsAt, endsAt).
 * Used by one-shift-per-day constraints, including overnight shifts.
 */
export function localDayKeysForWindow(startsAt: Date, endsAt: Date, tz: string): string[] {
  const firstKey = localDayKey(startsAt, tz);
  if (!isBefore(startsAt, endsAt)) return [firstKey];

  const seen = new Set<string>();
  const keys: string[] = [];

  const cursor = new TZDate(startsAt, tz);
  cursor.setHours(0, 0, 0, 0);

  let guard = 0;
  while (cursor.getTime() < endsAt.getTime() && guard < 400) {
    const key = localDayKey(new Date(cursor.getTime()), tz);
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
    cursor.setDate(cursor.getDate() + 1);
    guard++;
  }

  // Ensure the day containing the end boundary (exclusive) is represented.
  const endProbe = new Date(endsAt.getTime() - 1);
  const tailKey = localDayKey(endProbe < startsAt ? startsAt : endProbe, tz);
  if (!seen.has(tailKey)) {
    keys.push(tailKey);
  }

  return keys;
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
   * For generated shifts in this run, stores which local day keys each user
   * already occupies. Used to block assigning the same user twice in one day,
   * including overnight spill into the next day.
   */
  assignedDayKeysByUser: Map<string, Set<string>>;

  /**
   * People who worked rest-rule slots yesterday.
   * They should not work today when enough people are available.
   */
  lastNightAssigneeIds: Set<string>;

  /**
   * People who worked rest-rule slots two days ago.
   * They may work today, but should avoid another rest-rule slot if enough people exist.
   */
  twoAgoNightAssigneeIds: Set<string>;
}

interface DaySlotPlan {
  slotI: number;
  startsAt: Date;
  endsAt: Date;
  isNightForRestRule: boolean;
  isLateButNotNight: boolean;
  slotDayKeys: string[];
  preferredIdx: number;
}

function getCount(map: Map<string, number>, userId: string): number {
  return map.get(userId) ?? 0;
}

function getOrderedIndices(length: number, startIdx: number): number[] {
  return Array.from({ length }, (_, i) => (startIdx + i) % length);
}

function eachUtcDayInRange(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));

  while (cursor.getTime() < end.getTime()) {
    days.push(new Date(cursor.getTime()));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days;
}

function hasOccupiedConflict(
  userId: string,
  slot: { startsAt: Date; endsAt: Date },
  occupied: OccupiedMap,
  tz: string
): boolean {
  const slotDays = new Set(localDayKeysForWindow(slot.startsAt, slot.endsAt, tz));

  return (occupied.get(userId) ?? []).some(
    (o) => {
      if (overlaps(o, slot)) return true;
      const occupiedDays = localDayKeysForWindow(o.startsAt, o.endsAt, tz);
      return occupiedDays.some((day) => slotDays.has(day));
    }
  );
}

function normalizePriorIds(list: string[] | null | undefined, single: string | null | undefined): Set<string> {
  const ids = new Set<string>();

  for (const id of list ?? []) {
    if (typeof id === "string" && id.length > 0) ids.add(id);
  }

  if (single && single.length > 0) ids.add(single);

  return ids;
}

function seededRank(userId: string, seed: number): number {
  let hash = seed | 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

function buildStrictCandidates(
  plan: DaySlotPlan,
  participants: ParticipantSlot[],
  occupied: OccupiedMap,
  state: AssignmentState,
  tz: string,
  usedToday: Set<string>,
  restDayExclude: Set<string>,
  nightHardExclude: Set<string>,
  applyNightExclude: boolean
): number[] {
  const hardExclude = new Set(restDayExclude);

  for (const uid of usedToday) {
    hardExclude.add(uid);
  }

  for (const participant of participants) {
    const assignedDayKeys = state.assignedDayKeysByUser.get(participant.userId);
    if (!assignedDayKeys) continue;
    if (plan.slotDayKeys.some((dayKey) => assignedDayKeys.has(dayKey))) {
      hardExclude.add(participant.userId);
    }
  }

  const ordered = getOrderedIndices(participants.length, plan.preferredIdx);

  return ordered.filter((idx) => {
    const participant = participants[idx];
    const uid = participant.userId;

    if (hardExclude.has(uid)) return false;
    if (applyNightExclude && plan.isNightForRestRule && nightHardExclude.has(uid)) return false;
    if (hasOccupiedConflict(uid, { startsAt: plan.startsAt, endsAt: plan.endsAt }, occupied, tz)) return false;

    return true;
  });
}

function sortStrictCandidates(
  indices: number[],
  participants: ParticipantSlot[],
  plan: DaySlotPlan,
  temporaryAssignedCounts: Map<string, number>,
  temporaryNightCounts: Map<string, number>,
  previousAssigneeId: string | null,
  previousNightAssigneeId: string | null,
  previousLateAssigneeId: string | null
): number[] {
  const seed = Math.floor(plan.startsAt.getTime() / 60_000);

  return [...indices].sort((a, b) => {
    const aId = participants[a].userId;
    const bId = participants[b].userId;

    const aPenalty =
      (participants.length > 1 && aId === previousAssigneeId ? 1 : 0) +
      (plan.isNightForRestRule && participants.length > 1 && aId === previousNightAssigneeId ? 1 : 0) +
      (plan.isLateButNotNight && participants.length > 1 && aId === previousLateAssigneeId ? 1 : 0);
    const bPenalty =
      (participants.length > 1 && bId === previousAssigneeId ? 1 : 0) +
      (plan.isNightForRestRule && participants.length > 1 && bId === previousNightAssigneeId ? 1 : 0) +
      (plan.isLateButNotNight && participants.length > 1 && bId === previousLateAssigneeId ? 1 : 0);

    if (aPenalty !== bPenalty) return aPenalty - bPenalty;

    const aAssigned = temporaryAssignedCounts.get(aId) ?? 0;
    const bAssigned = temporaryAssignedCounts.get(bId) ?? 0;
    if (aAssigned !== bAssigned) return aAssigned - bAssigned;

    if (plan.isNightForRestRule) {
      const aNight = temporaryNightCounts.get(aId) ?? 0;
      const bNight = temporaryNightCounts.get(bId) ?? 0;
      if (aNight !== bNight) return aNight - bNight;
    }

    const aOrder = (a - plan.preferredIdx + participants.length) % participants.length;
    const bOrder = (b - plan.preferredIdx + participants.length) % participants.length;
    if (aOrder !== bOrder) return aOrder - bOrder;

    return seededRank(aId, seed) - seededRank(bId, seed);
  });
}

function assignDaySlotsStrict(
  plans: DaySlotPlan[],
  participants: ParticipantSlot[],
  occupied: OccupiedMap,
  state: AssignmentState,
  tz: string,
  restDayExclude: Set<string>,
  nightHardExclude: Set<string>
): number[] | null {
  const tryAssignment = (
    applyRestExclude: boolean,
    applyNightExclude: boolean
  ): number[] | null => {
    const assignment = new Array<number>(plans.length).fill(-1);
    const usedToday = new Set<string>();
    const temporaryAssignedCounts = new Map(state.assignedCounts);
    const temporaryNightCounts = new Map(state.nightCounts);
    const activeRestExclude = applyRestExclude ? restDayExclude : new Set<string>();

    const dfs = (
      previousAssigneeId: string | null,
      previousNightAssigneeId: string | null,
      previousLateAssigneeId: string | null
    ): boolean => {
      let nextPlanIndex = -1;
      let nextCandidates: number[] = [];

      for (let i = 0; i < plans.length; i++) {
        if (assignment[i] !== -1) continue;

        const candidates = buildStrictCandidates(
          plans[i],
          participants,
          occupied,
          state,
          tz,
          usedToday,
          activeRestExclude,
          nightHardExclude,
          applyNightExclude
        );

        if (candidates.length === 0) {
          return false;
        }

        if (nextPlanIndex === -1 || candidates.length < nextCandidates.length) {
          nextPlanIndex = i;
          nextCandidates = candidates;
        }
      }

      if (nextPlanIndex === -1) return true;

      const plan = plans[nextPlanIndex];
      const orderedCandidates = sortStrictCandidates(
        nextCandidates,
        participants,
        plan,
        temporaryAssignedCounts,
        temporaryNightCounts,
        previousAssigneeId,
        previousNightAssigneeId,
        previousLateAssigneeId
      );

      for (const participantIdx of orderedCandidates) {
        const uid = participants[participantIdx].userId;
        assignment[nextPlanIndex] = participantIdx;
        usedToday.add(uid);

        temporaryAssignedCounts.set(uid, (temporaryAssignedCounts.get(uid) ?? 0) + 1);

        let nextPreviousAssigneeId: string | null = uid;
        let nextPreviousNightAssigneeId = previousNightAssigneeId;
        let nextPreviousLateAssigneeId = previousLateAssigneeId;

        if (plan.isNightForRestRule) {
          temporaryNightCounts.set(uid, (temporaryNightCounts.get(uid) ?? 0) + 1);
          nextPreviousNightAssigneeId = uid;
        } else if (plan.isLateButNotNight) {
          nextPreviousLateAssigneeId = uid;
        }

        if (
          dfs(
            nextPreviousAssigneeId,
            nextPreviousNightAssigneeId,
            nextPreviousLateAssigneeId
          )
        ) {
          return true;
        }

        assignment[nextPlanIndex] = -1;
        usedToday.delete(uid);

        temporaryAssignedCounts.set(uid, (temporaryAssignedCounts.get(uid) ?? 1) - 1);
        if ((temporaryAssignedCounts.get(uid) ?? 0) <= 0) {
          temporaryAssignedCounts.delete(uid);
        }

        if (plan.isNightForRestRule) {
          temporaryNightCounts.set(uid, (temporaryNightCounts.get(uid) ?? 1) - 1);
          if ((temporaryNightCounts.get(uid) ?? 0) <= 0) {
            temporaryNightCounts.delete(uid);
          }
        }
      }

      return false;
    };

    const solved = dfs(
      state.previousAssigneeId,
      state.previousNightAssigneeId,
      state.previousLateAssigneeId
    );
    return solved ? assignment : null;
  };

  const configs: Array<{ applyRestExclude: boolean; applyNightExclude: boolean }> = [
    { applyRestExclude: true, applyNightExclude: true },
    { applyRestExclude: true, applyNightExclude: false },
    { applyRestExclude: false, applyNightExclude: true },
    { applyRestExclude: false, applyNightExclude: false },
  ];

  for (const cfg of configs) {
    const solved = tryAssignment(cfg.applyRestExclude, cfg.applyNightExclude);
    if (solved) return solved;
  }

  return null;
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
  nightHardExclude: Set<string>,

  /**
   * In strict mode, do not relax hard scheduling constraints.
   * If no candidate satisfies constraints, return null so caller can retry
   * with a different rotation seed or fail fast.
   */
  strictAssignment: boolean
): ParticipantSlot | null {
  const ordered = getOrderedIndices(participants.length, preferredIdx);

  // Step 1: Prefer people without occupied conflicts (same-day or overlap).
  const noCrossConflict = ordered.filter(
    (idx) => !hasOccupiedConflict(participants[idx].userId, slot, occupied, tz)
  );

  // Non-strict mode can relax to preserve backward compatibility.
  const crossPool =
    noCrossConflict.length > 0 ? noCrossConflict : strictAssignment ? [] : ordered;
  if (crossPool.length === 0) return null;

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

  const hardPool =
    withoutHardExclude.length > 0 ? withoutHardExclude : strictAssignment ? [] : crossPool;
  if (hardPool.length === 0) return null;

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
  isLateButNotNight: boolean,
  slotDayKeys: string[]
) {
  state.assignedCounts.set(assigneeId, getCount(state.assignedCounts, assigneeId) + 1);
  state.previousAssigneeId = assigneeId;

  const currentKeys = state.assignedDayKeysByUser.get(assigneeId) ?? new Set<string>();
  for (const dayKey of slotDayKeys) {
    currentKeys.add(dayKey);
  }
  state.assignedDayKeysByUser.set(assigneeId, currentKeys);

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
    strictAssignment?: boolean;
  }
): GeneratedShift[] {
  if (participants.length === 0) return [];

  // Prevent invalid or empty ranges from causing date-fns interval errors.
  if (!isBefore(rangeStart, rangeEnd)) return [];

  const shifts: GeneratedShift[] = [];
  let idx = startingIndex % participants.length;

  const tz = policy.timezone ?? "Asia/Ho_Chi_Minh";
  const occupied = options?.occupied ?? new Map();
  const prior = options?.priorState ?? {};
  const strictAssignment = options?.strictAssignment ?? false;
  const priorLastNightIds = normalizePriorIds(prior.lastNightAssigneeIds, prior.lastNightAssigneeId);
  const priorTwoAgoNightIds = normalizePriorIds(
    prior.twoAgoNightAssigneeIds,
    prior.twoAgoNightAssigneeId
  );

  const state: AssignmentState = {
    assignedCounts: new Map(),
    nightCounts: new Map(),
    previousAssigneeId: prior.previousAssigneeId ?? null,
    previousNightAssigneeId: prior.previousNightAssigneeId ?? null,
    previousLateAssigneeId: null,
    assignedDayKeysByUser: new Map(),
    lastNightAssigneeIds: priorLastNightIds,
    twoAgoNightAssigneeIds: priorTwoAgoNightIds,
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
    const days = eachUtcDayInRange(rangeStart, rangeEnd);

    // Move preferred base by 1 per day so everyone rotates through slot types.
    let dayBaseIdx = startingIndex % participants.length;
    const rollRestState = (nightIds: Set<string>) => {
      state.twoAgoNightAssigneeIds = new Set(state.lastNightAssigneeIds);
      state.lastNightAssigneeIds = new Set(nightIds);
    };

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

      if (slotsForDay.length === 0) {
        rollRestState(new Set());
        continue;
      }

      const lateSlotIndex = slotsForDay.length >= 2 ? slotsForDay.length - 1 : -1;
      const applyRestRule = participants.length > slotsForDay.length;

      /**
       * hardExclude:
       *   Person who worked a rest-rule slot yesterday cannot work today.
       */
      const restDayExclude: Set<string> = new Set();

      if (applyRestRule) {
        for (const uid of state.lastNightAssigneeIds) {
          restDayExclude.add(uid);
        }
      }

      /**
       * nightHardExclude:
       *   Person who worked a rest-rule slot two days ago should avoid a rest-rule slot today
       *   if enough people exist.
       */
      const nightHardExclude: Set<string> = new Set();

      if (applyRestRule) {
        for (const uid of state.twoAgoNightAssigneeIds) {
          nightHardExclude.add(uid);
        }
      }

      const plans: DaySlotPlan[] = [];

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

        // Skip slots that belong to local days strictly before the local rangeStart day.
        const slotStartDay = localDayKey(startsAt, tz);
        const rangeStartDay = localDayKey(rangeStart, tz);
        if (slotStartDay < rangeStartDay) continue;
        // If slot is on the local start day but already ended before rangeStart, skip it.
        if (slotStartDay === rangeStartDay && !isAfter(endsAt, rangeStart)) continue;

        // Stop if the slot starts after the requested rangeEnd.
        if (!isBefore(startsAt, rangeEnd)) break;

        // Skip slots that would end after the requested rangeEnd.
        if (isAfter(endsAt, rangeEnd)) continue;

        const isNightForRestRule = isRestRuleSlot(slot, overnight);
        const isLateButNotNight = !isNightForRestRule && slotI === lateSlotIndex;
        const slotDayKeys = localDayKeysForWindow(startsAt, endsAt, tz);
        const preferredIdx = (dayBaseIdx + slotI) % participants.length;

        plans.push({
          slotI,
          startsAt,
          endsAt,
          isNightForRestRule,
          isLateButNotNight,
          slotDayKeys,
          preferredIdx,
        });
      }

      if (plans.length === 0) {
        rollRestState(new Set());
        continue;
      }

      const strictAssignments = assignDaySlotsStrict(
        plans,
        participants,
        occupied,
        state,
        tz,
        restDayExclude,
        nightHardExclude
      );

      if (strictAssignment && !strictAssignments) {
        throw new Error(`UNASSIGNABLE_SLOT:${plans[0].startsAt.toISOString()}`);
      }

      const dayNightAssigneeIds = new Set<string>();

      for (let planIndex = 0; planIndex < plans.length; planIndex++) {
        const plan = plans[planIndex];

        let participant: ParticipantSlot | null = null;

        if (strictAssignments) {
          const assignedIdx = strictAssignments[planIndex];
          if (assignedIdx < 0 || assignedIdx >= participants.length) {
            throw new Error(`UNASSIGNABLE_SLOT:${plan.startsAt.toISOString()}`);
          }
          participant = participants[assignedIdx];
        } else {
          /**
           * Combine:
           * - rest-day exclusion from yesterday's rest-rule slot;
           * - already-assigned-today exclusion.
           */
          const currentHardExclude = new Set(restDayExclude);

          for (const participantSlot of participants) {
            const assignedDayKeys = state.assignedDayKeysByUser.get(participantSlot.userId);
            if (!assignedDayKeys) continue;
            if (plan.slotDayKeys.some((dayKey) => assignedDayKeys.has(dayKey))) {
              currentHardExclude.add(participantSlot.userId);
            }
          }

          /**
           * Apply D+2 night exclusion only on rest-rule slots.
           * On normal slots, the person can work again on D+2.
           */
          const effectiveNightExclude = plan.isNightForRestRule
            ? nightHardExclude
            : new Set<string>();

          participant = selectParticipant(
            participants,
            plan.preferredIdx,
            { startsAt: plan.startsAt, endsAt: plan.endsAt },
            plan.isNightForRestRule,
            plan.isLateButNotNight,
            occupied,
            state,
            tz,
            currentHardExclude,
            effectiveNightExclude,
            strictAssignment
          );
        }

        if (!participant) {
          throw new Error(`UNASSIGNABLE_SLOT:${plan.startsAt.toISOString()}`);
        }

        shifts.push({
          assigneeId: participant.userId,
          backupId: participant.backupId,
          startsAt: plan.startsAt,
          endsAt: plan.endsAt,
        });

        recordAssignment(
          state,
          participant.userId,
          plan.isNightForRestRule,
          plan.isLateButNotNight,
          plan.slotDayKeys
        );

        if (plan.isNightForRestRule) {
          dayNightAssigneeIds.add(participant.userId);
        }
      }

      /**
       * Roll rest-rule state forward by one day:
       *
       * Before:
       *   lastNightAssigneeIds = people from yesterday
       *   twoAgoNightAssigneeIds = people from two days ago
       *
       * After:
       *   twoAgoNightAssigneeIds = old yesterday people
       *   lastNightAssigneeIds = today's rest-rule people
       */
      rollRestState(dayNightAssigneeIds);

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
        occupied,
        state,
        tz,
        new Set(),
        new Set(),
        strictAssignment
      );
      if (!participant) {
        throw new Error(
          `UNASSIGNABLE_SLOT:${startsAt.toISOString()}`
        );
      }

      shifts.push({
        assigneeId: participant.userId,
        backupId: participant.backupId,
        startsAt,
        endsAt,
      });

      recordAssignment(
        state,
        participant.userId,
        false,
        false,
        localDayKeysForWindow(startsAt, endsAt, tz)
      );

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
      occupied,
      state,
      tz,
      new Set(),
      new Set(),
      strictAssignment
    );
    if (!participant) {
      throw new Error(
        `UNASSIGNABLE_SLOT:${startsAt.toISOString()}`
      );
    }

    shifts.push({
      assigneeId: participant.userId,
      backupId: participant.backupId,
      startsAt,
      endsAt,
    });

    recordAssignment(
      state,
      participant.userId,
      false,
      false,
      localDayKeysForWindow(startsAt, endsAt, tz)
    );

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
