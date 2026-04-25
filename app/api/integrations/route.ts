import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser, requireTeamRole, isNextResponse } from "@/lib/rbac";
import { ok, created, badRequest, unauthorized, handleError } from "@/lib/api-response";
import { IntegrationType, TeamRole } from "@/app/generated/prisma/client";

const CreateSchema = z.object({
  teamId: z.string().uuid(),
  name: z.string().min(1).max(120),
  type: z.nativeEnum(IntegrationType).default(IntegrationType.GENERIC_WEBHOOK),
});

export async function GET(req: NextRequest) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const teamId = req.nextUrl.searchParams.get("teamId");

    const integrations = await prisma.alertIntegration.findMany({
      where: teamId ? { teamId } : undefined,
      include: {
        team: { select: { id: true, name: true } },
        _count: { select: { alerts: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return ok(integrations);
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

    const integration = await prisma.alertIntegration.create({
      data,
      include: { team: { select: { id: true, name: true } } },
    });

    return created(integration);
  } catch (error) {
    return handleError(error);
  }
}
