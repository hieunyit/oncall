import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/rbac";
import { ok, unauthorized, forbidden, handleError } from "@/lib/api-response";
import { AlertStatus, SystemRole } from "@/app/generated/prisma/client";

export async function GET(req: NextRequest) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const status = req.nextUrl.searchParams.get("status") as AlertStatus | null;
    const teamId = req.nextUrl.searchParams.get("teamId");
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "50"), 200);
    const isAdmin = actor.systemRole === SystemRole.ADMIN;

    const myTeamIds = isAdmin
      ? []
      : (
          await prisma.teamMember.findMany({
            where: { userId: actor.id },
            select: { teamId: true },
          })
        ).map((m) => m.teamId);

    if (teamId && !isAdmin && !myTeamIds.includes(teamId)) {
      return forbidden();
    }

    const alerts = await prisma.alert.findMany({
      where: {
        ...(status ? { status } : {}),
        integration: teamId
          ? { teamId }
          : isAdmin
            ? undefined
            : { teamId: { in: myTeamIds } },
      },
      include: {
        integration: { select: { id: true, name: true, team: { select: { id: true, name: true } } } },
        acknowledger: { select: { id: true, fullName: true } },
      },
      orderBy: { triggeredAt: "desc" },
      take: limit,
    });

    return ok(alerts);
  } catch (error) {
    return handleError(error);
  }
}
