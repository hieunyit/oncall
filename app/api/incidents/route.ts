import { NextRequest } from "next/server";
import { endOfMonth, startOfMonth } from "date-fns";
import { z } from "zod";
import {
  IncidentSeverity,
  IncidentStatus,
} from "@/app/generated/prisma/client";
import { created, badRequest, forbidden, handleError, ok, unauthorized } from "@/lib/api-response";
import { getSessionUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { ensureTeamAccess, getIncidentAccessScope } from "@/lib/incidents/access";
import { incidentInclude } from "@/lib/incidents/query";
import { buildIncidentWhere } from "@/lib/incidents/filters";
import { INCIDENT_API_ERRORS } from "@/lib/incidents/text";

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
    const statusParam = params.get("status");
    const severityParam = params.get("severity");
    const keyword = params.get("q")?.trim() ?? "";
    const limit = Number.parseInt(params.get("limit") ?? "300", 10);
    const pageParam = Number.parseInt(params.get("page") ?? "1", 10);
    const pageSizeParam = Number.parseInt(params.get("pageSize") ?? "50", 10);
    const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
    const pageSize = Number.isFinite(pageSizeParam)
      ? Math.min(Math.max(pageSizeParam, 1), 200)
      : 50;
    const hasExplicitRange = params.has("start") || params.has("end");

    const now = new Date();
    const rangeStart =
      parseDateParam(params.get("start")) ?? (shiftId && !hasExplicitRange ? null : startOfMonth(now));
    const rangeEnd =
      parseDateParam(params.get("end")) ?? (shiftId && !hasExplicitRange ? null : endOfMonth(now));

    if (rangeStart && rangeEnd && rangeEnd < rangeStart) {
      return badRequest(INCIDENT_API_ERRORS.INVALID_RANGE);
    }

    const statusFilter = Object.values(IncidentStatus).includes(
      statusParam as IncidentStatus
    )
      ? (statusParam as IncidentStatus)
      : undefined;
    const severityFilter = Object.values(IncidentSeverity).includes(
      severityParam as IncidentSeverity
    )
      ? (severityParam as IncidentSeverity)
      : undefined;

    const scope = await getIncidentAccessScope(user.id, user.systemRole);
    if (!scope.isAdmin && scope.teamIds.length === 0) {
      return ok({ incidents: [], rangeStart, rangeEnd });
    }

    if (teamId && !ensureTeamAccess(scope, teamId)) {
      return forbidden();
    }

    const where = buildIncidentWhere({
      rangeStart,
      rangeEnd,
      selectedTeamId: teamId ?? undefined,
      isAdmin: scope.isAdmin,
      allowedTeamIds: scope.teamIds,
      selectedPolicyId: policyId ?? undefined,
      statusFilter,
      severityFilter,
      keyword,
      shiftId: shiftId ?? undefined,
    });

    const total = await prisma.incident.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const normalizedPage = Math.min(page, totalPages);

    const incidents = await prisma.incident.findMany({
      where,
      include: incidentInclude,
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      skip: (normalizedPage - 1) * pageSize,
      take: params.has("page") || params.has("pageSize")
        ? pageSize
        : Number.isFinite(limit)
          ? Math.min(Math.max(limit, 1), 1000)
          : 300,
    });

    return ok({
      incidents,
      rangeStart: rangeStart ?? null,
      rangeEnd: rangeEnd ?? null,
      count: incidents.length,
      total,
      page: normalizedPage,
      pageSize,
      totalPages,
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
      return badRequest(INCIDENT_API_ERRORS.SHIFT_NOT_IN_TEAM);
    }
    if (shiftForIncident.assigneeId !== user.id) {
      return forbidden(INCIDENT_API_ERRORS.NOT_ASSIGNEE);
    }
    if (data.policyId && data.policyId !== shiftForIncident.policyId) {
      return badRequest(INCIDENT_API_ERRORS.POLICY_SHIFT_MISMATCH);
    }

    const policyIdToUse = data.policyId ?? shiftForIncident.policyId;
    const assigneeIdToUse = data.assigneeId ?? shiftForIncident.assigneeId;

    if (assigneeIdToUse) {
      const membership = await prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId: data.teamId, userId: assigneeIdToUse } },
        select: { id: true },
      });
      if (!membership) {
        return badRequest(INCIDENT_API_ERRORS.ASSIGNEE_NOT_IN_TEAM);
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
          note: "Tạo incident",
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
