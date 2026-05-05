import { Prisma, ShiftStatus } from "@/app/generated/prisma/client";

type BuildScheduleShiftWhereInput = {
  teamId?: string;
  policyId?: string;
  isAdmin: boolean;
  currentUserId: string;
  rangeStart: Date;
  rangeEnd: Date;
};

function buildScheduleAccessFilter(
  teamId: string | undefined,
  isAdmin: boolean,
  currentUserId: string
): Prisma.ShiftWhereInput | null {
  if (teamId) {
    return { policy: { teamId } };
  }
  if (isAdmin) {
    return null;
  }
  return {
    OR: [
      { assigneeId: currentUserId },
      { policy: { team: { members: { some: { userId: currentUserId } } } } },
    ],
  };
}

export function buildScheduleShiftWhere(
  input: BuildScheduleShiftWhereInput
): Prisma.ShiftWhereInput {
  const accessFilter = buildScheduleAccessFilter(
    input.teamId,
    input.isAdmin,
    input.currentUserId
  );
  const andFilters: Prisma.ShiftWhereInput[] = [
    ...(accessFilter ? [accessFilter] : []),
    { policy: { isActive: true } },
  ];

  return {
    ...(input.policyId ? { policyId: input.policyId } : {}),
    AND: andFilters,
    startsAt: { lte: input.rangeEnd },
    endsAt: { gte: input.rangeStart },
    status: {
      in: [ShiftStatus.PUBLISHED, ShiftStatus.ACTIVE, ShiftStatus.COMPLETED],
    },
  };
}

