import { addHours, addDays, addWeeks, isAfter, isBefore, eachDayOfInterval, subDays } from "date-fns";
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

export function generateShifts(
  policy: PolicyConfig,
  participants: ParticipantSlot[],
  rangeStart: Date,
  rangeEnd: Date,
  startingIndex = 0
): GeneratedShift[] {
  if (participants.length === 0) return [];

  const shifts: GeneratedShift[] = [];
  let idx = startingIndex % participants.length;

  if (policy.timeSlots && policy.timeSlots.length > 0) {
    // Time slot mode: iterate days, generate one shift per slot per day
    const days = eachDayOfInterval({ start: rangeStart, end: subDays(rangeEnd, 1) });
    for (const day of days) {
      const dow = day.getDay(); // 0=Sun,1=Mon,...,6=Sat
      for (const slot of policy.timeSlots) {
        if (slot.daysOfWeek && slot.daysOfWeek.length > 0 && !slot.daysOfWeek.includes(dow)) continue;
        const startsAt = new Date(day);
        startsAt.setHours(slot.startHour, slot.startMinute, 0, 0);
        const endsAt = new Date(day);
        endsAt.setHours(slot.endHour, slot.endMinute, 0, 0);
        if (endsAt <= startsAt) endsAt.setDate(endsAt.getDate() + 1);
        if (isAfter(startsAt, rangeEnd)) break;
        const participant = participants[idx % participants.length];
        shifts.push({ assigneeId: participant.userId, backupId: participant.backupId, startsAt, endsAt });
        idx++;
      }
    }
    return shifts;
  }

  let current = rangeStart;

  while (isBefore(current, rangeEnd)) {
    const startsAt = new Date(current);
    const rawEndsAt = addHours(startsAt, policy.shiftDurationHours);
    const endsAt =
      policy.handoverOffsetMinutes !== 0
        ? new Date(rawEndsAt.getTime() + policy.handoverOffsetMinutes * 60_000)
        : rawEndsAt;

    if (isAfter(endsAt, rangeEnd)) break;

    const slot = participants[idx % participants.length];
    shifts.push({
      assigneeId: slot.userId,
      backupId: slot.backupId,
      startsAt,
      endsAt,
    });

    idx++;
    current =
      policy.cadence === CadenceKind.DAILY
        ? addDays(startsAt, 1)
        : policy.cadence === CadenceKind.WEEKLY
          ? addWeeks(startsAt, 1)
          : addHours(startsAt, policy.shiftDurationHours);
  }

  return shifts;
}

export function computeConfirmationDueAt(
  shift: GeneratedShift,
  confirmationDueHours: number
): Date {
  return new Date(
    shift.startsAt.getTime() - confirmationDueHours * 60 * 60 * 1000
  );
}

export function computeReminderFireAt(
  shift: GeneratedShift,
  leadHours: number
): Date {
  return new Date(shift.startsAt.getTime() - leadHours * 60 * 60 * 1000);
}
