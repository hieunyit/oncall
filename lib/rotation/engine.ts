import { addHours, addDays, addWeeks, parseISO, isAfter, isBefore, startOfDay } from "date-fns";
import { CadenceKind } from "@/app/generated/prisma/client";

export interface PolicyConfig {
  cadence: CadenceKind;
  cronExpression?: string | null;
  shiftDurationHours: number;
  handoverOffsetMinutes: number;
  confirmationDueHours: number;
  reminderLeadHours: number[];
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
  let current = rangeStart;
  let idx = startingIndex % participants.length;

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
