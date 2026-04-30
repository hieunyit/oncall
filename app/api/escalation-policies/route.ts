import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser, requireTeamRole, isNextResponse } from "@/lib/rbac";
import { ok, created, badRequest, unauthorized, forbidden, handleError } from "@/lib/api-response";
import { TeamRole, SystemRole } from "@/app/generated/prisma/client";

const CreateSchema = z.object({
  teamId: z.string().uuid(),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const teamId = req.nextUrl.searchParams.get("teamId");
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

    const policies = await prisma.escalationPolicy.findMany({
      where: teamId
        ? { teamId }
        : isAdmin
          ? undefined
          : { teamId: { in: myTeamIds } },
      include: {
        team: { select: { id: true, name: true } },
        rules: { orderBy: { stepOrder: "asc" } },
      },
      orderBy: { createdAt: "asc" },
    });

    return ok(policies);
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const body = await req.json().catch(() => null);
    if (!body) return badRequest("Invalid JSON");

    const data = CreateSchema.parse(body);

    const result = await requireTeamRole(data.teamId, TeamRole.MANAGER);
    if (isNextResponse(result)) return result;

    const policy = await prisma.escalationPolicy.create({
      data: {
        teamId: data.teamId,
        name: data.name,
        description: data.description ?? null,
      },
      include: {
        team: { select: { id: true, name: true } },
        rules: true,
      },
    });

    return created(policy);
  } catch (error) {
    return handleError(error);
  }
}
