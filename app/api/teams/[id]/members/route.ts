import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser, requireTeamRole, isNextResponse } from "@/lib/rbac";
import {
  ok,
  created,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  handleError,
} from "@/lib/api-response";
import { TeamRole } from "@/app/generated/prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { notifyUserAddedToTeam } from "@/lib/notifications/notify-team-member";

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

const RESCHEDULE_SKIP_CODES = new Set(["NO_PUBLISHED_BATCH", "BATCH_EXPIRED", "POLICY_INACTIVE"]);

type PolicyRescheduleSummary = {
  totalPolicies: number;
  ok: number;
  skipped: number;
  failed: number;
  queueDegraded: number;
  failedPolicies: Array<{ policyId: string; error: string }>;
};

type RescheduleApiPayload = {
  code?: string;
  error?: string;
  data?: { remindersScheduled?: boolean };
  remindersScheduled?: boolean;
};

async function rescheduleTeamPoliciesFromNow(input: {
  teamId: string;
  origin: string;
  cookieHeader: string | null;
}) {
  const policies = await prisma.rotationPolicy.findMany({
    where: { teamId: input.teamId, isActive: true },
    select: { id: true },
  });

  const summary: PolicyRescheduleSummary = {
    totalPolicies: policies.length,
    ok: 0,
    skipped: 0,
    failed: 0,
    queueDegraded: 0,
    failedPolicies: [],
  };

  for (const policy of policies) {
    try {
      const res = await fetch(`${input.origin}/api/policies/${policy.id}/reschedule-from-now`, {
        method: "POST",
        cache: "no-store",
        headers: {
          ...(input.cookieHeader ? { cookie: input.cookieHeader } : {}),
        },
      });

      const payload = (await res.json().catch(() => ({}))) as RescheduleApiPayload;
      if (!res.ok) {
        if (typeof payload.code === "string" && RESCHEDULE_SKIP_CODES.has(payload.code)) {
          summary.skipped += 1;
          continue;
        }
        summary.failed += 1;
        summary.failedPolicies.push({
          policyId: policy.id,
          error: payload.error ?? payload.code ?? "Reschedule failed",
        });
        continue;
      }

      summary.ok += 1;
      const remindersScheduled = payload.data?.remindersScheduled ?? payload.remindersScheduled ?? true;
      if (!remindersScheduled) {
        summary.queueDegraded += 1;
      }
    } catch (error) {
      summary.failed += 1;
      summary.failedPolicies.push({
        policyId: policy.id,
        error: (error as Error).message,
      });
    }
  }

  return summary;
}

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
    const team = await prisma.team.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
    if (!team) return notFound("Team not found");

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

    const telegramNotice = await notifyUserAddedToTeam({
      userId,
      teamId: team.id,
      teamName: team.name,
      role,
      actorName: actor.fullName,
    });

    return created({
      ...member,
      telegramNotice,
    });
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

    const before = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: id, userId } },
    });
    if (!before) return notFound("Member not found");

    const member = await prisma.teamMember.update({
      where: { teamId_userId: { teamId: id, userId } },
      data,
    });

    await writeAuditLog({
      actorId: actor.id,
      entityType: "TeamMember",
      entityId: member.id,
      action: "UPDATE",
      oldValue: before,
      newValue: member,
      ipAddress: req.headers.get("x-forwarded-for") ?? undefined,
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
    const { searchParams } = req.nextUrl;
    const userId = searchParams.get("userId");
    if (!userId) return notFound("userId query param required");
    const isSelfDelete = actor.id === userId;

    if (actor.systemRole !== "ADMIN") {
      const roleCheck = await requireTeamRole(id, TeamRole.MANAGER);
      if (isNextResponse(roleCheck)) return roleCheck;
      if (isSelfDelete) {
        return forbidden("Manager cannot remove themselves from team");
      }
    }

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
    const rescheduleSummary = await rescheduleTeamPoliciesFromNow({
      teamId: id,
      origin: req.nextUrl.origin,
      cookieHeader: req.headers.get("cookie"),
    });

    await writeAuditLog({
      actorId: actor.id,
      entityType: "Team",
      entityId: id,
      action: "RESCHEDULE_POLICIES_AFTER_MEMBER_DELETE",
      newValue: {
        removedUserId: userId,
        ...rescheduleSummary,
      },
      ipAddress: req.headers.get("x-forwarded-for") ?? undefined,
    });

    return ok({
      removed: true,
      rescheduleSummary,
    });
  } catch (error) {
    return handleError(error);
  }
}
