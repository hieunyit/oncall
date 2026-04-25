import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser, requireTeamRole, isNextResponse } from "@/lib/rbac";
import { ok, badRequest, unauthorized, notFound, handleError } from "@/lib/api-response";
import { ShiftStatus, ShiftSource, TeamRole } from "@/app/generated/prisma/client";
import { writeAuditLog } from "@/lib/audit";

const OverrideSchema = z.object({
  assigneeId: z.string().uuid(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  notes: z.string().max(500).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const { id } = await params;
    const shift = await prisma.shift.findUnique({
      where: { id },
      include: { policy: { select: { teamId: true, name: true } } },
    });
    if (!shift) return notFound("Shift not found");

    const result = await requireTeamRole(shift.policy.teamId, TeamRole.MANAGER);
    if (isNextResponse(result)) return result;

    const body = await req.json().catch(() => null);
    if (!body) return badRequest("Invalid JSON");

    const data = OverrideSchema.parse(body);
    const startsAt = new Date(data.startsAt);
    const endsAt = new Date(data.endsAt);

    if (endsAt <= startsAt) return badRequest("endsAt must be after startsAt");

    const override = await prisma.shift.create({
      data: {
        policyId: shift.policyId,
        batchId: shift.batchId,
        assigneeId: data.assigneeId,
        overrideForShiftId: shift.id,
        startsAt,
        endsAt,
        status: ShiftStatus.PUBLISHED,
        source: ShiftSource.OVERRIDE,
        notes: data.notes ?? null,
      },
      include: {
        assignee: { select: { id: true, fullName: true, email: true } },
        policy: { select: { id: true, name: true } },
      },
    });

    await writeAuditLog({
      actorId: actor.id,
      entityType: "Shift",
      entityId: override.id,
      action: "OVERRIDE",
      oldValue: { originalShiftId: shift.id },
      newValue: override,
      ipAddress: req.headers.get("x-forwarded-for") ?? undefined,
    });

    return ok(override);
  } catch (error) {
    return handleError(error);
  }
}
