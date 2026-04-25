import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser, requireTeamRole, isNextResponse } from "@/lib/rbac";
import { ok, noContent, unauthorized, notFound, handleError } from "@/lib/api-response";
import { CadenceKind, TeamRole } from "@/app/generated/prisma/client";
import { writeAuditLog } from "@/lib/audit";

const UpdatePolicySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  cadence: z.nativeEnum(CadenceKind).optional(),
  cronExpression: z.string().optional().nullable(),
  shiftDurationHours: z.number().int().min(1).max(168).optional(),
  handoverOffsetMinutes: z.number().int().min(0).optional(),
  confirmationDueHours: z.number().int().min(1).optional(),
  reminderLeadHours: z.array(z.number().int().positive()).optional(),
  maxGenerateWeeks: z.number().int().min(1).max(52).optional(),
  escalationPolicyId: z.string().uuid().nullable().optional(),
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
    const policy = await prisma.rotationPolicy.findUnique({
      where: { id },
      include: {
        team: {
          include: {
            members: {
              include: {
                user: { select: { id: true, email: true, fullName: true } },
              },
              orderBy: { order: "asc" },
            },
          },
        },
      },
    });

    if (!policy) return notFound("Policy not found");

    const result = await requireTeamRole(policy.teamId, TeamRole.MEMBER);
    if (isNextResponse(result)) return result;

    return ok(policy);
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
    const policy = await prisma.rotationPolicy.findUnique({ where: { id } });
    if (!policy) return notFound("Policy not found");

    const result = await requireTeamRole(policy.teamId, TeamRole.MANAGER);
    if (isNextResponse(result)) return result;

    const body = await req.json();
    const data = UpdatePolicySchema.parse(body);

    const updated = await prisma.rotationPolicy.update({ where: { id }, data });

    await writeAuditLog({
      actorId: actor.id,
      entityType: "RotationPolicy",
      entityId: id,
      action: "UPDATE",
      oldValue: policy,
      newValue: updated,
      ipAddress: req.headers.get("x-forwarded-for") ?? undefined,
    });

    return ok(updated);
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
    const policy = await prisma.rotationPolicy.findUnique({ where: { id } });
    if (!policy) return notFound("Policy not found");

    const result = await requireTeamRole(policy.teamId, TeamRole.MANAGER);
    if (isNextResponse(result)) return result;

    await prisma.rotationPolicy.update({
      where: { id },
      data: { isActive: false },
    });

    await writeAuditLog({
      actorId: actor.id,
      entityType: "RotationPolicy",
      entityId: id,
      action: "DEACTIVATE",
      oldValue: policy,
      ipAddress: req.headers.get("x-forwarded-for") ?? undefined,
    });

    return noContent();
  } catch (error) {
    return handleError(error);
  }
}
