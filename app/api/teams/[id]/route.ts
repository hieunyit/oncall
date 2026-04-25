import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser, requireTeamRole, isNextResponse } from "@/lib/rbac";
import {
  ok,
  noContent,
  unauthorized,
  forbidden,
  notFound,
  handleError,
} from "@/lib/api-response";
import { SystemRole, TeamRole } from "@/app/generated/prisma/client";
import { writeAuditLog } from "@/lib/audit";

const UpdateTeamSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  slackChannel: z.string().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const { id } = await params;
    const result = await requireTeamRole(id, TeamRole.MEMBER);
    if (isNextResponse(result)) return result;

    const team = await prisma.team.findUnique({
      where: { id },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, email: true, fullName: true, isActive: true },
            },
          },
          orderBy: { order: "asc" },
        },
        rotationPolicies: { where: { isActive: true } },
        _count: { select: { members: true } },
      },
    });

    if (!team) return notFound("Team not found");
    return ok(team);
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
    const result = await requireTeamRole(id, TeamRole.MANAGER);
    if (isNextResponse(result)) return result;

    const body = await req.json();
    const data = UpdateTeamSchema.parse(body);

    const before = await prisma.team.findUnique({ where: { id } });
    if (!before) return notFound("Team not found");

    const team = await prisma.team.update({ where: { id }, data });

    await writeAuditLog({
      actorId: actor.id,
      entityType: "Team",
      entityId: id,
      action: "UPDATE",
      oldValue: before,
      newValue: team,
      ipAddress: req.headers.get("x-forwarded-for") ?? undefined,
    });

    return ok(team);
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();
    if (actor.systemRole !== SystemRole.ADMIN) return forbidden();

    const { id } = await params;
    const team = await prisma.team.findUnique({ where: { id } });
    if (!team) return notFound("Team not found");

    await prisma.team.delete({ where: { id } });

    await writeAuditLog({
      actorId: actor.id,
      entityType: "Team",
      entityId: id,
      action: "DELETE",
      oldValue: team,
      ipAddress: req.headers.get("x-forwarded-for") ?? undefined,
    });

    return noContent();
  } catch (error) {
    return handleError(error);
  }
}
