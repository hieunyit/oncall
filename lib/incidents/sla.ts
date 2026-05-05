import {
  IncidentSeverity,
  IncidentStatus,
} from "@/app/generated/prisma/client";

type SlaTargets = {
  acknowledgeMinutes: number;
  resolveMinutes: number;
};

type IncidentSlaInput = {
  severity: IncidentSeverity;
  status: IncidentStatus;
  occurredAt: Date;
  resolvedAt: Date | null;
  lifecycleEvents?: Array<{
    toStatus: IncidentStatus;
    createdAt: Date;
  }>;
};

type IncidentSlaSnapshot = {
  acknowledgeDeadlineAt: Date;
  resolveDeadlineAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedBreached: boolean;
  resolvedBreached: boolean;
  isAcknowledged: boolean;
  isResolved: boolean;
};

const INCIDENT_SLA_TARGETS: Record<IncidentSeverity, SlaTargets> = {
  LOW: { acknowledgeMinutes: 60, resolveMinutes: 24 * 60 },
  MEDIUM: { acknowledgeMinutes: 30, resolveMinutes: 8 * 60 },
  HIGH: { acknowledgeMinutes: 15, resolveMinutes: 4 * 60 },
  CRITICAL: { acknowledgeMinutes: 5, resolveMinutes: 60 },
};

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function isAcknowledgedStatus(status: IncidentStatus) {
  return status !== IncidentStatus.OPEN;
}

function findAcknowledgedAt(input: IncidentSlaInput): Date | null {
  const firstLifecycleAcknowledge = input.lifecycleEvents
    ?.filter((event) => isAcknowledgedStatus(event.toStatus))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];

  if (firstLifecycleAcknowledge) return firstLifecycleAcknowledge.createdAt;
  if (isAcknowledgedStatus(input.status)) return input.resolvedAt ?? input.occurredAt;
  return null;
}

export function computeIncidentSlaSnapshot(
  input: IncidentSlaInput,
  now = new Date()
): IncidentSlaSnapshot {
  const targets = INCIDENT_SLA_TARGETS[input.severity];
  const acknowledgeDeadlineAt = addMinutes(
    input.occurredAt,
    targets.acknowledgeMinutes
  );
  const resolveDeadlineAt = addMinutes(input.occurredAt, targets.resolveMinutes);
  const acknowledgedAt = findAcknowledgedAt(input);
  const isResolved = Boolean(input.resolvedAt);
  const isAcknowledged = Boolean(acknowledgedAt);

  const acknowledgedBreached = isAcknowledged
    ? acknowledgedAt!.getTime() > acknowledgeDeadlineAt.getTime()
    : now.getTime() > acknowledgeDeadlineAt.getTime();

  const resolveCheckAt = input.resolvedAt ?? now;
  const resolvedBreached = resolveCheckAt.getTime() > resolveDeadlineAt.getTime();

  return {
    acknowledgeDeadlineAt,
    resolveDeadlineAt,
    acknowledgedAt,
    acknowledgedBreached,
    resolvedBreached,
    isAcknowledged,
    isResolved,
  };
}

