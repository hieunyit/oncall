import { reminderQueue, escalationQueue } from "@/lib/queue/queues";
import { computeReminderFireAt, computeConfirmationDueAt } from "@/lib/rotation/engine";
import type { ReminderJobPayload, EscalationJobPayload } from "@/lib/queue/jobs";

interface ConfirmationInfo {
  id: string;
  shiftId: string;
  userId: string;
  dueAt: Date;
  shift: {
    startsAt: Date;
    endsAt: Date;
  };
}

interface PolicyInfo {
  id: string;
  reminderLeadHours: number[];
  confirmationDueHours: number;
}

export async function scheduleRemindersForConfirmation(
  confirmation: ConfirmationInfo,
  policy: PolicyInfo
) {
  const now = Date.now();

  for (const leadHours of policy.reminderLeadHours) {
    const fireAt = computeReminderFireAt(
      { assigneeId: confirmation.userId, startsAt: confirmation.shift.startsAt, endsAt: confirmation.shift.endsAt },
      leadHours
    );

    // Skip if fire time is in the past
    if (fireAt.getTime() <= now) continue;

    const delay = fireAt.getTime() - now;

    const payload: ReminderJobPayload = {
      shiftId: confirmation.shiftId,
      confirmationId: confirmation.id,
      recipientId: confirmation.userId,
      leadHours,
    };

    await reminderQueue.add(
      `reminder-${confirmation.id}-${leadHours}h`,
      payload,
      {
        delay,
        jobId: `reminder-${confirmation.id}-${leadHours}h`,
        removeOnComplete: true,
      }
    );
  }
}

export async function scheduleEscalationForConfirmation(
  confirmation: ConfirmationInfo,
  policy: PolicyInfo
) {
  const now = Date.now();

  // Escalation fires at confirmation due time if still PENDING
  const fireAt = confirmation.dueAt;
  if (fireAt.getTime() <= now) return;

  const delay = fireAt.getTime() - now;

  const payload: EscalationJobPayload = {
    shiftId: confirmation.shiftId,
    confirmationId: confirmation.id,
    step: 1,
    policyId: policy.id,
  };

  await escalationQueue.add(
    `escalation-${confirmation.id}-step1`,
    payload,
    {
      delay,
      jobId: `escalation-${confirmation.id}-step1`,
      removeOnComplete: true,
    }
  );
}

export async function scheduleAllRemindersForBatch(
  confirmations: ConfirmationInfo[],
  policy: PolicyInfo
) {
  await Promise.all(
    confirmations.flatMap((c) => [
      scheduleRemindersForConfirmation(c, policy),
      scheduleEscalationForConfirmation(c, policy),
    ])
  );
}
