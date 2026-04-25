import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser, requireTeamRole, isNextResponse } from "@/lib/rbac";
import { ok, unauthorized, notFound, conflict, handleError } from "@/lib/api-response";
import { ShiftStatus, TeamRole } from "@/app/generated/prisma/client";
import { writeAuditLog } from "@/lib/audit";

const UpdateShiftSchema = z.object({
  version: z.number().int().min(0),
  notes: z.string().optional().nullable(),
  backupId: z.string().uuid().optional().nullable(),
  status: z.nativeEnum(ShiftStatus).optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const { id } = await params;
    const shift = await prisma.shift.findUnique({
      where: { id },
      include: {
        assignee: { select: { id: true, email: true, fullName: true, timezone: true } },
        backup: { select: { id: true, email: true, fullName: true } },
        confirmation: true,
        policy: { select: { id: true, name: true, teamId: true } },
      },
    });

    if (!shift) return notFound("Shift not found");
    return ok(shift);
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
    const shift = await prisma.shift.findUnique({
      where: { id },
      include: { policy: { select: { teamId: true } } },
    });
    if (!shift) return notFound("Shift not found");

    const result = await requireTeamRole(shift.policy.teamId, TeamRole.MANAGER);
    if (isNextResponse(result)) return result;

    const body = await req.json();
    const { version, ...data } = UpdateShiftSchema.parse(body);

    // Optimistic locking: UPDATE ... WHERE version = $expected
    const updated = await prisma.$executeRaw`
      UPDATE shifts
      SET
        notes = COALESCE(${data.notes ?? null}, notes),
        backup_id = ${data.backupId ?? null},
        status = COALESCE(${data.status ?? null}::"ShiftStatus", status),
        version = version + 1,
        updated_at = NOW()
      WHERE id = ${id}::uuid AND version = ${version}
      RETURNING id
    `;

    if (updated === 0) {
      return conflict(
        "Shift was modified by another request. Reload and retry.",
        "CONFLICT_VERSION"
      );
    }

    const fresh = await prisma.shift.findUnique({ where: { id } });

    await writeAuditLog({
      actorId: actor.id,
      entityType: "Shift",
      entityId: id,
      action: "UPDATE",
      oldValue: shift,
      newValue: fresh,
      ipAddress: req.headers.get("x-forwarded-for") ?? undefined,
    });

    return ok(fresh);
  } catch (error) {
    return handleError(error);
  }
}
