import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, requireTeamRole, isNextResponse } from "@/lib/rbac";
import { ok, unauthorized, notFound, handleError } from "@/lib/api-response";
import { TeamRole } from "@/app/generated/prisma/client";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const { id } = await params;
    const alert = await prisma.alert.findUnique({
      where: { id },
      include: { integration: { select: { teamId: true } } },
    });
    if (!alert) return notFound("Alert not found");

    const roleCheck = await requireTeamRole(alert.integration.teamId, TeamRole.MEMBER);
    if (isNextResponse(roleCheck)) return roleCheck;

    if (alert.status === "RESOLVED") return ok(alert);

    const updated = await prisma.alert.update({
      where: { id },
      data: {
        status: "RESOLVED",
        resolvedAt: new Date(),
        ...(alert.status === "FIRING" ? { acknowledgedById: actor.id, acknowledgedAt: new Date() } : {}),
      },
    });

    return ok(updated);
  } catch (error) {
    return handleError(error);
  }
}
