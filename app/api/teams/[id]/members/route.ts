import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser, requireTeamRole, isNextResponse } from "@/lib/rbac";
import {
  ok,
  created,
  noContent,
  unauthorized,
  notFound,
  conflict,
  handleError,
} from "@/lib/api-response";
import { TeamRole } from "@/app/generated/prisma/client";
import { writeAuditLog } from "@/lib/audit";

const AddMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.nativeEnum(TeamRole).default(TeamRole.MEMBER),
  order: z.number().int().min(0).default(0),
});

const UpdateMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.nativeEnum(TeamRole).optional(),
  order: z.number().int().min(0).optional(),
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

    const members = await prisma.teamMember.findMany({
      where: { teamId: id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            isActive: true,
            timezone: true,
          },
        },
      },
      orderBy: { order: "asc" },
    });

    return ok(members);
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(
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
    const { userId, role, order } = AddMemberSchema.parse(body);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return notFound("User not found");

    const existing = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: id, userId } },
    });
    if (existing) return conflict("User is already a member of this team");

    const member = await prisma.teamMember.create({
      data: { teamId: id, userId, role, order },
      include: {
        user: { select: { id: true, email: true, fullName: true } },
      },
    });

    await writeAuditLog({
      actorId: actor.id,
      entityType: "TeamMember",
      entityId: member.id,
      action: "CREATE",
      newValue: member,
      ipAddress: req.headers.get("x-forwarded-for") ?? undefined,
    });

    return created(member);
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
    const { userId, ...data } = UpdateMemberSchema.parse(body);

    const member = await prisma.teamMember.update({
      where: { teamId_userId: { teamId: id, userId } },
      data,
    });

    return ok(member);
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

    const { id } = await params;
    const result = await requireTeamRole(id, TeamRole.MANAGER);
    if (isNextResponse(result)) return result;

    const { searchParams } = req.nextUrl;
    const userId = searchParams.get("userId");
    if (!userId) return notFound("userId query param required");

    const member = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: id, userId } },
    });
    if (!member) return notFound("Member not found");

    await prisma.teamMember.delete({
      where: { teamId_userId: { teamId: id, userId } },
    });

    await writeAuditLog({
      actorId: actor.id,
      entityType: "TeamMember",
      entityId: member.id,
      action: "DELETE",
      oldValue: member,
      ipAddress: req.headers.get("x-forwarded-for") ?? undefined,
    });

    return noContent();
  } catch (error) {
    return handleError(error);
  }
}
