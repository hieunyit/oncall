import {
  IncidentSeverity,
  IncidentStatus,
  Prisma,
} from "@/app/generated/prisma/client";

type BuildIncidentWhereInput = {
  rangeStart: Date | null;
  rangeEnd: Date | null;
  selectedTeamId?: string;
  isAdmin: boolean;
  allowedTeamIds?: string[];
  selectedPolicyId?: string;
  statusFilter?: IncidentStatus;
  severityFilter?: IncidentSeverity;
  keyword?: string;
  shiftId?: string;
};

export function buildIncidentWhere(
  input: BuildIncidentWhereInput
): Prisma.IncidentWhereInput {
  const andFilters: Prisma.IncidentWhereInput[] = [];

  if (input.rangeStart && input.rangeEnd) {
    andFilters.push({
      occurredAt: { gte: input.rangeStart, lte: input.rangeEnd },
    });
  }

  if (input.selectedTeamId) {
    andFilters.push({ teamId: input.selectedTeamId });
  } else if (!input.isAdmin) {
    andFilters.push({ teamId: { in: input.allowedTeamIds ?? [] } });
  }

  if (input.selectedPolicyId) {
    andFilters.push({ policyId: input.selectedPolicyId });
  }

  if (input.shiftId) {
    andFilters.push({ shiftId: input.shiftId });
  }

  if (input.statusFilter) {
    andFilters.push({ status: input.statusFilter });
  }

  if (input.severityFilter) {
    andFilters.push({ severity: input.severityFilter });
  }

  const keyword = input.keyword?.trim();
  if (keyword) {
    andFilters.push({
      OR: [
        { title: { contains: keyword, mode: "insensitive" } },
        { description: { contains: keyword, mode: "insensitive" } },
        { impactSummary: { contains: keyword, mode: "insensitive" } },
        { rootCause: { contains: keyword, mode: "insensitive" } },
        { actionItems: { contains: keyword, mode: "insensitive" } },
      ],
    });
  }

  if (andFilters.length === 0) {
    return {};
  }
  return { AND: andFilters };
}
