import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser, requireTeamRole, isNextResponse } from "@/lib/rbac";
import { ok, created, unauthorized, forbidden, badRequest, handleError } from "@/lib/api-response";
import { CadenceKind, TeamRole, SystemRole } from "@/app/generated/prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { setPolicyParticipantUserIds } from "@/lib/rotation/policy-participants";

const TimeSlotSchema = z.object({
  label: z.string(),
  startHour: z.number().int().min(0).max(23),
  startMinute: z.number().int().min(0).max(59),
  endHour: z.number().int().min(0).max(23),
  endMinute: z.number().int().min(0).max(59),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
});

const CreatePolicySchema = z.object({
  teamId: z.string().uuid(),
  name: z.string().min(1).max(200),
  cadence: z.nativeEnum(CadenceKind),
  cronExpression: z.string().optional(),
  shiftDurationHours: z.number().int().min(1).max(168),
  handoverOffsetMinutes: z.number().int().min(0).default(0),
  confirmationDueHours: z.number().int().min(1).default(24),
  reminderLeadHours: z.array(z.number().int().positive()).default([24, 2]),
  maxGenerateWeeks: z.number().int().min(1).max(52).default(4),
  escalationPolicyId: z.string().uuid().nullable().optional(),
  timeSlots: z.array(TimeSlotSchema).optional(),
  checklistRequired: z.boolean().optional(),
  templateTasks: z.array(z.string().min(1).max(500)).optional(),
  memberIds: z.array(z.string().uuid()).min(1).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const { searchParams } = req.nextUrl;
    const teamId = searchParams.get("teamId");
    const isAdmin = actor.systemRole === SystemRole.ADMIN;

    const myTeamIds = isAdmin
      ? []
      : (
          await prisma.teamMember.findMany({
            where: { userId: actor.id },
            select: { teamId: true },
          })
        ).map((m) => m.teamId);

    if (teamId && !isAdmin && !myTeamIds.includes(teamId)) {
      return forbidden();
    }

    const where = teamId
      ? { teamId, isActive: true }
      : isAdmin
        ? { isActive: true }
        : { teamId: { in: myTeamIds }, isActive: true };

    const policies = await prisma.rotationPolicy.findMany({
      where,
      include: {
        team: { select: { id: true, name: true } },
        _count: { select: { shifts: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return ok(policies);
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const body = await req.json();
    const { checklistRequired, templateTasks, memberIds, ...data } = CreatePolicySchema.parse(body);

    const result = await requireTeamRole(data.teamId, TeamRole.MANAGER);
    if (isNextResponse(result)) return result;

    const teamMembers = await prisma.teamMember.findMany({
      where: { teamId: data.teamId },
      select: { userId: true },
    });
    if (teamMembers.length === 0) {
      return badRequest("Nhóm chưa có thành viên để tạo chính sách trực");
    }

    const teamUserIdSet = new Set(teamMembers.map((m) => m.userId));
    const selectedMemberIds = memberIds && memberIds.length > 0
      ? [...new Set(memberIds)]
      : teamMembers.map((m) => m.userId);
    const invalidMemberIds = selectedMemberIds.filter((id) => !teamUserIdSet.has(id));
    if (invalidMemberIds.length > 0) {
      return badRequest("Danh sách thành viên áp dụng không hợp lệ");
    }

    const policy = await prisma.rotationPolicy.create({ data });
    await setPolicyParticipantUserIds(policy.id, selectedMemberIds);

    // Save checklist fields via raw SQL (migration 4 may not be applied yet)
    if (checklistRequired !== undefined || (templateTasks && templateTasks.length > 0)) {
      try {
        await prisma.$executeRaw`
          UPDATE rotation_policies
          SET checklist_required = ${checklistRequired ?? false}::boolean,
              template_tasks     = ${JSON.stringify(templateTasks ?? [])}::jsonb
          WHERE id = ${policy.id}::uuid
        `;
      } catch {
        // Columns not yet created — migration 4 pending.
      }
    }

    await writeAuditLog({
      actorId: actor.id,
      entityType: "RotationPolicy",
      entityId: policy.id,
      action: "CREATE",
      newValue: policy,
      ipAddress: req.headers.get("x-forwarded-for") ?? undefined,
    });

    return created({ ...policy, participantUserIds: selectedMemberIds });
  } catch (error) {
    return handleError(error);
  }
}
