import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/rbac";
import { ok, unauthorized, forbidden, notFound, handleError } from "@/lib/api-response";
import { SystemRole } from "@/app/generated/prisma/client";
import { writeAuditLog } from "@/lib/audit";

const UpdateUserSchema = z.object({
  fullName: z.string().min(1).max(200).optional(),
  timezone: z.string().optional(),
  isActive: z.boolean().optional(),
  systemRole: z.nativeEnum(SystemRole).optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const { id } = await params;
    if (actor.systemRole !== SystemRole.ADMIN && actor.id !== id) return forbidden();

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        fullName: true,
        systemRole: true,
        timezone: true,
        isActive: true,
        telegramChatId: true,
        teamsUserId: true,
        createdAt: true,
        updatedAt: true,
        teamMembers: {
          select: {
            role: true,
            order: true,
            team: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!user) return notFound("User not found");
    return ok(user);
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
    const isSelf = actor.id === id;
    const isAdmin = actor.systemRole === SystemRole.ADMIN;
    if (!isAdmin && !isSelf) return forbidden();

    const body = await req.json();
    const data = UpdateUserSchema.parse(body);

    // Only admins can change systemRole or isActive
    if (!isAdmin) {
      delete data.systemRole;
      delete data.isActive;
    }

    const before = await prisma.user.findUnique({ where: { id } });
    if (!before) return notFound("User not found");

    const user = await prisma.user.update({ where: { id }, data });

    await writeAuditLog({
      actorId: actor.id,
      entityType: "User",
      entityId: id,
      action: "UPDATE",
      oldValue: before,
      newValue: user,
      ipAddress: req.headers.get("x-forwarded-for") ?? undefined,
    });

    return ok(user);
  } catch (error) {
    return handleError(error);
  }
}
