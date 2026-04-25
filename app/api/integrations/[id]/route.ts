import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser, requireTeamRole, isNextResponse } from "@/lib/rbac";
import { ok, noContent, badRequest, unauthorized, notFound, handleError } from "@/lib/api-response";
import { TeamRole } from "@/app/generated/prisma/client";

const UpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  isActive: z.boolean().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const { id } = await params;
    const integration = await prisma.alertIntegration.findUnique({
      where: { id },
      include: {
        team: { select: { id: true, name: true } },
        alerts: {
          orderBy: { triggeredAt: "desc" },
          take: 20,
          include: { acknowledger: { select: { id: true, fullName: true } } },
        },
        _count: { select: { alerts: true } },
      },
    });
    if (!integration) return notFound("Integration not found");

    const result = await requireTeamRole(integration.teamId, TeamRole.MEMBER);
    if (isNextResponse(result)) return result;

    return ok(integration);
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const { id } = await params;
    const integration = await prisma.alertIntegration.findUnique({ where: { id } });
    if (!integration) return notFound("Integration not found");

    const result = await requireTeamRole(integration.teamId, TeamRole.MANAGER);
    if (isNextResponse(result)) return result;

    const body = await req.json().catch(() => null);
    if (!body) return badRequest("Invalid JSON");

    const data = UpdateSchema.parse(body);
    const updated = await prisma.alertIntegration.update({ where: { id }, data });
    return ok(updated);
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const { id } = await params;
    const integration = await prisma.alertIntegration.findUnique({ where: { id } });
    if (!integration) return notFound("Integration not found");

    const result = await requireTeamRole(integration.teamId, TeamRole.MANAGER);
    if (isNextResponse(result)) return result;

    await prisma.alertIntegration.delete({ where: { id } });
    return noContent();
  } catch (error) {
    return handleError(error);
  }
}
