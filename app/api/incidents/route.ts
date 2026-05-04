import { NextRequest } from "next/server";
import { endOfMonth, startOfMonth } from "date-fns";
import { z } from "zod";
import { IncidentSeverity } from "@/app/generated/prisma/client";
import { created, badRequest, forbidden, handleError, ok, unauthorized } from "@/lib/api-response";
import { getSessionUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { ensureTeamAccess, getIncidentAccessScope } from "@/lib/incidents/access";
import { incidentInclude } from "@/lib/incidents/query";

const CreateIncidentSchema = z.object({
  teamId: z.string().uuid(),
  policyId: z.string().uuid().nullable().optional(),
  shiftId: z.string().uuid(),
  title: z.string().trim().min(3).max(180),
  description: z.string().trim().max(8000).optional(),
  severity: z.nativeEnum(IncidentSeverity).default(IncidentSeverity.MEDIUM),
  occurredAt: z.string().datetime(),
  assigneeId: z.string().uuid().nullable().optional(),
  impactSummary: z.string().trim().max(4000).optional(),
  rootCause: z.string().trim().max(4000).optional(),
  actionItems: z.string().trim().max(4000).optional(),
});

function parseDateParam(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export async function GET(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return unauthorized();

    const params = req.nextUrl.searchParams;
    const teamId = params.get("teamId");
    const policyId = params.get("policyId");
    const shiftId = params.get("shiftId");
    const limit = Number.parseInt(params.get("limit") ?? "300", 10);
    const hasExplicitRange = params.has("start") || params.has("end");

    const now = new Date();
    const rangeStart =
      parseDateParam(params.get("start")) ?? (shiftId && !hasExplicitRange ? null : startOfMonth(now));
    const rangeEnd =
      parseDateParam(params.get("end")) ?? (shiftId && !hasExplicitRange ? null : endOfMonth(now));

    if (rangeStart && rangeEnd && rangeEnd < rangeStart) {
      return badRequest("end phai lon hon hoac bang start");
    }

    const scope = await getIncidentAccessScope(user.id, user.systemRole);
    if (!scope.isAdmin && scope.teamIds.length === 0) {
      return ok({ incidents: [], rangeStart, rangeEnd });
    }

    if (teamId && !ensureTeamAccess(scope, teamId)) {
      return forbidden();
    }

    const incidents = await prisma.incident.findMany({
      where: {
        ...(rangeStart && rangeEnd ? { occurredAt: { gte: rangeStart, lte: rangeEnd } } : {}),
        ...(policyId ? { policyId } : {}),
        ...(shiftId ? { shiftId } : {}),
        ...(teamId
          ? { teamId }
          : scope.isAdmin
            ? {}
            : { teamId: { in: scope.teamIds } }),
      },
      include: incidentInclude,
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      take: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 1000) : 300,
    });

    return ok({
      incidents,
      rangeStart: rangeStart ?? null,
      rangeEnd: rangeEnd ?? null,
      count: incidents.length,
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return unauthorized();

    const body = await req.json();
    const data = CreateIncidentSchema.parse(body);

    const scope = await getIncidentAccessScope(user.id, user.systemRole);
    if (!ensureTeamAccess(scope, data.teamId)) {
      return forbidden();
    }

    const shiftForIncident = await prisma.shift.findUnique({
      where: { id: data.shiftId },
      select: {
        id: true,
        assigneeId: true,
        policyId: true,
        policy: { select: { teamId: true } },
      },
    });
    if (!shiftForIncident || shiftForIncident.policy.teamId !== data.teamId) {
      return badRequest("shiftId khong thuoc team da chon");
    }
    if (shiftForIncident.assigneeId !== user.id) {
      return forbidden("Chi nguoi truc cua ca nay moi duoc tao incident/report");
    }
    if (data.policyId && data.policyId !== shiftForIncident.policyId) {
      return badRequest("policyId khong khop voi shiftId da chon");
    }

    const policyIdToUse = data.policyId ?? shiftForIncident.policyId;
    const assigneeIdToUse = data.assigneeId ?? shiftForIncident.assigneeId;

    if (assigneeIdToUse) {
      const membership = await prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId: data.teamId, userId: assigneeIdToUse } },
        select: { id: true },
      });
      if (!membership) {
        return badRequest("assigneeId phai la thanh vien cua team");
      }
    }

    const occurredAt = new Date(data.occurredAt);

    const incident = await prisma.$transaction(async (tx) => {
      const createdIncident = await tx.incident.create({
        data: {
          teamId: data.teamId,
          policyId: policyIdToUse,
          shiftId: data.shiftId,
          title: data.title,
          description: data.description?.trim() || null,
          severity: data.severity,
          occurredAt,
          createdById: user.id,
          assigneeId: assigneeIdToUse,
          impactSummary: data.impactSummary?.trim() || null,
          rootCause: data.rootCause?.trim() || null,
          actionItems: data.actionItems?.trim() || null,
        },
      });

      await tx.incidentLifecycleEvent.create({
        data: {
          incidentId: createdIncident.id,
          fromStatus: null,
          toStatus: createdIncident.status,
          changedById: user.id,
          note: "Tao incident",
        },
      });

      return tx.incident.findUniqueOrThrow({
        where: { id: createdIncident.id },
        include: incidentInclude,
      });
    });

    return created(incident);
  } catch (error) {
    return handleError(error);
  }
}
