import { prisma } from "@/lib/prisma";

type PolicyParticipantRow = {
  participant_user_ids: unknown;
};

export function normalizePolicyParticipantUserIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];

  const unique = new Set<string>();
  for (const value of raw) {
    if (typeof value === "string" && value.length > 0) {
      unique.add(value);
    }
  }

  return [...unique];
}

export async function getPolicyParticipantUserIds(policyId: string): Promise<string[] | null> {
  try {
    const rows = await prisma.$queryRaw<PolicyParticipantRow[]>`
      SELECT participant_user_ids
      FROM rotation_policies
      WHERE id = ${policyId}::uuid
    `;
    if (rows.length === 0) return null;
    return normalizePolicyParticipantUserIds(rows[0].participant_user_ids);
  } catch {
    // Column may not exist before migration is applied.
    return null;
  }
}

export async function setPolicyParticipantUserIds(policyId: string, userIds: string[]): Promise<void> {
  const normalized = normalizePolicyParticipantUserIds(userIds);
  try {
    await prisma.$executeRaw`
      UPDATE rotation_policies
      SET participant_user_ids = ${JSON.stringify(normalized)}::jsonb
      WHERE id = ${policyId}::uuid
    `;
  } catch {
    // Column may not exist before migration is applied.
  }
}

export function filterTeamMembersByPolicySelection<T extends { user: { id: string } }>(
  members: T[],
  selectedUserIds: string[] | null | undefined
): T[] {
  if (!selectedUserIds || selectedUserIds.length === 0) return members;

  const selectedSet = new Set(selectedUserIds);
  return members.filter((member) => selectedSet.has(member.user.id));
}
