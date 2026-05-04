import { SystemRole, TeamRole } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export interface IncidentAccessScope {
  isAdmin: boolean;
  teamIds: string[];
  managerTeamIds: string[];
}

export async function getIncidentAccessScope(
  userId: string,
  systemRole: SystemRole
): Promise<IncidentAccessScope> {
  if (systemRole === SystemRole.ADMIN) {
    return { isAdmin: true, teamIds: [], managerTeamIds: [] };
  }

  const memberships = await prisma.teamMember.findMany({
    where: { userId },
    select: { teamId: true, role: true },
  });

  const teamIds = memberships.map((member) => member.teamId);
  const managerTeamIds = memberships
    .filter((member) => member.role === TeamRole.MANAGER)
    .map((member) => member.teamId);

  return { isAdmin: false, teamIds, managerTeamIds };
}

export function ensureTeamAccess(scope: IncidentAccessScope, teamId: string): boolean {
  return scope.isAdmin || scope.teamIds.includes(teamId);
}

export function ensureTeamManagerAccess(scope: IncidentAccessScope, teamId: string): boolean {
  return scope.isAdmin || scope.managerTeamIds.includes(teamId);
}
