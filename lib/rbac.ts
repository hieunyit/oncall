import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SystemRole, TeamRole } from "@/app/generated/prisma/client";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export type SessionUser = {
  id: string;
  email: string;
  systemRole: SystemRole;
  fullName: string;
};

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.email) return null;

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: {
      id: true,
      email: true,
      systemRole: true,
      fullName: true,
      isActive: true,
    },
  });

  if (!user || !user.isActive) return null;
  return user;
}

export function requireAuth() {
  return async function (req: NextRequest) {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return null;
  };
}

export async function requireSystemRole(role: SystemRole): Promise<NextResponse | null> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.systemRole !== role) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export async function requireTeamRole(
  teamId: string,
  minimumRole: TeamRole
): Promise<{ user: SessionUser; teamRole: TeamRole } | NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (user.systemRole === SystemRole.ADMIN) {
    return { user, teamRole: TeamRole.MANAGER };
  }

  const membership = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId: user.id } },
    select: { role: true },
  });

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const roleOrder: Record<TeamRole, number> = {
    MANAGER: 2,
    MEMBER: 1,
  };

  if (roleOrder[membership.role] < roleOrder[minimumRole]) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return { user, teamRole: membership.role };
}

export function isNextResponse(v: unknown): v is NextResponse {
  return v instanceof NextResponse;
}
