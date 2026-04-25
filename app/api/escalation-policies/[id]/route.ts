import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser, requireTeamRole, isNextResponse } from "@/lib/rbac";
import { ok, noContent, badRequest, unauthorized, notFound, handleError } from "@/lib/api-response";
import { ChannelType, EscalationTarget, TeamRole } from "@/app/generated/prisma/client";

const UpdatePolicySchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
});

const RuleSchema = z.object({
  stepOrder: z.number().int().min(1),
  target: z.nativeEnum(EscalationTarget),
  delayMinutes: z.number().int().min(0),
  channelType: z.nativeEnum(ChannelType),
  isActive: z.boolean().optional(),
});

const UpsertRulesSchema = z.object({
  rules: z.array(RuleSchema),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const { id } = await params;
    const policy = await prisma.escalationPolicy.findUnique({
      where: { id },
      include: {
        team: { select: { id: true, name: true } },
        rules: { orderBy: { stepOrder: "asc" } },
        rotationPolicies: { select: { id: true, name: true } },
      },
    });
    if (!policy) return notFound("Escalation policy not found");

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
    const policy = await prisma.escalationPolicy.findUnique({ where: { id } });
    if (!policy) return notFound("Escalation policy not found");

    const result = await requireTeamRole(policy.teamId, TeamRole.MANAGER);
    if (isNextResponse(result)) return result;

    const body = await req.json().catch(() => null);
    if (!body) return badRequest("Invalid JSON");

    const data = UpdatePolicySchema.parse(body);

    const updated = await prisma.escalationPolicy.update({
      where: { id },
      data,
      include: {
        team: { select: { id: true, name: true } },
        rules: { orderBy: { stepOrder: "asc" } },
      },
    });

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
    const policy = await prisma.escalationPolicy.findUnique({ where: { id } });
    if (!policy) return notFound("Escalation policy not found");

    const result = await requireTeamRole(policy.teamId, TeamRole.MANAGER);
    if (isNextResponse(result)) return result;

    await prisma.escalationPolicy.delete({ where: { id } });
    return noContent();
  } catch (error) {
    return handleError(error);
  }
}

// PUT /api/escalation-policies/[id]/rules — replace all rules atomically
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const { id } = await params;
    const policy = await prisma.escalationPolicy.findUnique({ where: { id } });
    if (!policy) return notFound("Escalation policy not found");

    const result = await requireTeamRole(policy.teamId, TeamRole.MANAGER);
    if (isNextResponse(result)) return result;

    const body = await req.json().catch(() => null);
    if (!body) return badRequest("Invalid JSON");

    const { rules } = UpsertRulesSchema.parse(body);

    const updated = await prisma.$transaction(async (tx) => {
      await tx.escalationRule.deleteMany({ where: { escalationPolicyId: id } });
      await tx.escalationRule.createMany({
        data: rules.map((r) => ({
          escalationPolicyId: id,
          stepOrder: r.stepOrder,
          target: r.target,
          delayMinutes: r.delayMinutes,
          channelType: r.channelType,
          isActive: r.isActive ?? true,
        })),
      });
      return tx.escalationPolicy.findUnique({
        where: { id },
        include: { rules: { orderBy: { stepOrder: "asc" } } },
      });
    });

    return ok(updated);
  } catch (error) {
    return handleError(error);
  }
}
