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
 * Map of userId → list of existing shifts from OTHER policies that belong to the same team.
 * Used to skip participants who would violate the cross-policy constraint:
 * a person cannot have overlapping shifts from two different policies in the same team.
 */
export type OccupiedMap = Map<string, Array<{ policyId: string; startsAt: Date; endsAt: Date }>>;

function overlaps(a: { startsAt: Date; endsAt: Date }, b: { startsAt: Date; endsAt: Date }): boolean {
  return a.startsAt < b.endsAt && a.endsAt > b.startsAt;
}

/**
 * Returns the participant to assign for a given slot.
 * Starts from `idx` and looks forward (wrapping) for the first person with no cross-policy conflict.
 * Falls back to round-robin if everyone is busy.
 */
function pickParticipant(
  participants: ParticipantSlot[],
  idx: number,
  slot: { startsAt: Date; endsAt: Date },
  currentPolicyId: string | undefined,
  occupied: OccupiedMap
): ParticipantSlot {
  for (let i = 0; i < participants.length; i++) {
    const p = participants[(idx + i) % participants.length];
    if (!currentPolicyId) return p; // no conflict checking if policyId unknown
    const conflicts = (occupied.get(p.userId) ?? []).some(
      (o) => o.policyId !== currentPolicyId && overlaps(o, slot)
    );
    if (!conflicts) return p;
  }
  // all busy → fall back to round-robin
  return participants[idx % participants.length];
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

  function applyHandover(rawEnd: Date): Date {
    return policy.handoverOffsetMinutes !== 0
      ? new Date(rawEnd.getTime() + policy.handoverOffsetMinutes * 60_000)
      : rawEnd;
  }

  // ── Time-slot mode ────────────────────────────────────────────────────────
  if (policy.timeSlots && policy.timeSlots.length > 0) {
    const days = eachDayOfInterval({ start: rangeStart, end: subDays(rangeEnd, 1) });

    for (const day of days) {
      const dow = day.getUTCDay(); // 0=Sun … 6=Sat; use UTC to avoid server-tz shift

      for (const slot of policy.timeSlots) {
        if (slot.daysOfWeek && slot.daysOfWeek.length > 0 && !slot.daysOfWeek.includes(dow)) continue;

        const startsAt = tzDateTime(day, slot.startHour, slot.startMinute, tz);
        let endsAt = tzDateTime(day, slot.endHour, slot.endMinute, tz);

        // Overnight shift: end time is on the next calendar day
        if (endsAt <= startsAt) {
          const nextDay = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + 1));
          endsAt = tzDateTime(nextDay, slot.endHour, slot.endMinute, tz);
        }

        if (isAfter(startsAt, rangeEnd)) break;

        const participant = pickParticipant(participants, idx, { startsAt, endsAt }, policyId, occupied);
        shifts.push({ assigneeId: participant.userId, backupId: participant.backupId, startsAt, endsAt });
        idx++;
      }
    }
    return shifts;
  }

  // ── CUSTOM_CRON mode ──────────────────────────────────────────────────────
  if (policy.cadence === CadenceKind.CUSTOM_CRON) {
    if (!policy.cronExpression) return shifts;

    const cron = new Cron(policy.cronExpression, { timezone: tz });
    // Start from the first cron fire at or after rangeStart
    let next = cron.nextRun(new Date(rangeStart.getTime() - 1));

    while (next && isBefore(next, rangeEnd)) {
      const startsAt = new Date(next);
      const endsAt = applyHandover(addHours(startsAt, policy.shiftDurationHours));

      if (isAfter(endsAt, rangeEnd)) break;

      const participant = pickParticipant(participants, idx, { startsAt, endsAt }, policyId, occupied);
      shifts.push({ assigneeId: participant.userId, backupId: participant.backupId, startsAt, endsAt });
      idx++;

      next = cron.nextRun(startsAt);
    }
    return shifts;
  }

  // ── DAILY / WEEKLY cadence ────────────────────────────────────────────────
  let current = rangeStart;

  while (isBefore(current, rangeEnd)) {
    const startsAt = new Date(current);
    const endsAt = applyHandover(addHours(startsAt, policy.shiftDurationHours));

    if (isAfter(endsAt, rangeEnd)) break;

    const participant = pickParticipant(participants, idx, { startsAt, endsAt }, policyId, occupied);
    shifts.push({ assigneeId: participant.userId, backupId: participant.backupId, startsAt, endsAt });
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
