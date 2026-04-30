import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser, requireTeamRole, isNextResponse } from "@/lib/rbac";
import { ok, noContent, unauthorized, notFound, handleError } from "@/lib/api-response";
import { BatchStatus, CadenceKind, ShiftStatus, SwapStatus, TeamRole } from "@/app/generated/prisma/client";
import { writeAuditLog } from "@/lib/audit";

const TimeSlotSchema = z.object({
  label: z.string(),
  startHour: z.number().int().min(0).max(23),
  startMinute: z.number().int().min(0).max(59),
  endHour: z.number().int().min(0).max(23),
  endMinute: z.number().int().min(0).max(59),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
});

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
  timeSlots: z.array(TimeSlotSchema).optional().nullable(),
  checklistRequired: z.boolean().optional(),
  templateTasks: z.array(z.string().min(1).max(500)).optional().nullable(),
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
    const { escalationPolicyId, timeSlots, templateTasks, checklistRequired, ...rest } = UpdatePolicySchema.parse(body);

    // Fields supported by current generated Prisma client (stable columns)
    const updated = await prisma.rotationPolicy.update({
      where: { id },
      data: {
        ...rest,
        ...(escalationPolicyId !== undefined && { escalationPolicyId }),
        ...(timeSlots !== undefined && { timeSlots: timeSlots ?? [] }),
      },
    });

    // checklistRequired + templateTasks require migration 4 — update via raw SQL,
    // silently skip if columns don't exist yet (pre-migration environments)
    if (checklistRequired !== undefined || templateTasks !== undefined) {
      try {
        await prisma.$executeRaw`
          UPDATE rotation_policies
          SET
            checklist_required = COALESCE(${checklistRequired ?? null}::boolean, checklist_required),
            template_tasks     = COALESCE(${templateTasks !== undefined ? JSON.stringify(templateTasks ?? []) : null}::jsonb, template_tasks)
          WHERE id = ${id}::uuid
        `;
      } catch {
        // Columns not yet created — migration 4 pending. Changes ignored until deployed.
      }
    }

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

    const now = new Date();
    const shiftsToRemove = await prisma.shift.findMany({
      where: {
        policyId: id,
        // Remove all unfinished shifts that are ongoing/future so dashboard and schedule
        // don't keep showing on-call entries after policy deletion.
        endsAt: { gte: now },
        status: {
          in: [
            ShiftStatus.DRAFT,
            ShiftStatus.PUBLISHED,
            ShiftStatus.ACTIVE,
            ShiftStatus.CANCELLED,
          ],
        },
      },
      select: { id: true },
    });
    const removeIds = shiftsToRemove.map((s) => s.id);

    let removedBatchCount = 0;
    await prisma.$transaction(async (tx) => {
      await tx.rotationPolicy.update({
        where: { id },
        data: { isActive: false },
      });

      if (removeIds.length > 0) {
        await tx.swapRequest.updateMany({
          where: {
            status: { in: [SwapStatus.REQUESTED, SwapStatus.ACCEPTED_BY_TARGET] },
            OR: [
              { originalShiftId: { in: removeIds } },
              { targetShiftId: { in: removeIds } },
            ],
          },
          data: { status: SwapStatus.CANCELLED, version: { increment: 1 } },
        });

        await tx.shiftConfirmation.deleteMany({ where: { shiftId: { in: removeIds } } });
        await tx.shiftTask.deleteMany({ where: { shiftId: { in: removeIds } } });
        await tx.shift.deleteMany({ where: { id: { in: removeIds } } });
      }

      const partiallyRemainingBatchIds = (
        await tx.scheduleBatch.findMany({
          where: {
            policyId: id,
            status: BatchStatus.PUBLISHED,
            shifts: { some: { status: { in: [ShiftStatus.ACTIVE, ShiftStatus.COMPLETED] } } },
          },
          select: { id: true },
        })
      ).map((b) => b.id);

      if (partiallyRemainingBatchIds.length > 0) {
        await tx.scheduleBatch.updateMany({
          where: { id: { in: partiallyRemainingBatchIds } },
          data: { status: BatchStatus.PARTIAL },
        });
      }

      const emptyBatchIds = (
        await tx.scheduleBatch.findMany({
          where: {
            policyId: id,
            shifts: { none: {} },
          },
          select: { id: true },
        })
      ).map((b) => b.id);

      if (emptyBatchIds.length > 0) {
        const deleted = await tx.scheduleBatch.deleteMany({ where: { id: { in: emptyBatchIds } } });
        removedBatchCount = deleted.count;
      }
    });

    await writeAuditLog({
      actorId: actor.id,
      entityType: "RotationPolicy",
      entityId: id,
      action: "DELETE",
      oldValue: policy,
      newValue: {
        isActive: false,
        removedShifts: removeIds.length,
        removedBatches: removedBatchCount,
      },
      ipAddress: req.headers.get("x-forwarded-for") ?? undefined,
    });

    return noContent();
  } catch (error) {
    return handleError(error);
  }
}
