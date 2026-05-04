import { NextRequest } from "next/server";
import { IncidentStatus, IncidentSeverity } from "@/app/generated/prisma/client";
import { z } from "zod";
import { badRequest, forbidden, handleError, notFound, ok, unauthorized } from "@/lib/api-response";
import { getSessionUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { ensureTeamAccess, getIncidentAccessScope } from "@/lib/incidents/access";
import { incidentInclude } from "@/lib/incidents/query";

const PatchIncidentSchema = z.object({
  title: z.string().trim().min(3).max(180).optional(),
  description: z.string().trim().max(8000).nullable().optional(),
  severity: z.nativeEnum(IncidentSeverity).optional(),
  status: z.nativeEnum(IncidentStatus).optional(),
  occurredAt: z.string().datetime().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  impactSummary: z.string().trim().max(4000).nullable().optional(),
  rootCause: z.string().trim().max(4000).nullable().optional(),
  actionItems: z.string().trim().max(4000).nullable().optional(),
  lifecycleNote: z.string().trim().max(2000).optional(),
});

function normalizeNullableText(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getSessionUser();
    if (!user) return unauthorized();

    const { id } = await params;
    const scope = await getIncidentAccessScope(user.id, user.systemRole);

    const incident = await prisma.incident.findUnique({
      where: { id },
      include: incidentInclude,
    });
    if (!incident) return notFound("Incident không tồn tại");
    if (!ensureTeamAccess(scope, incident.teamId)) return forbidden();

    return ok(incident);
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getSessionUser();
    if (!user) return unauthorized();

    const { id } = await params;
    const body = await req.json();
    const data = PatchIncidentSchema.parse(body);

    const scope = await getIncidentAccessScope(user.id, user.systemRole);
    const existing = await prisma.incident.findUnique({
      where: { id },
      select: {
        id: true,
        teamId: true,
        status: true,
      },
    });

    if (!existing) return badRequest("Incident không tồn tại");
    if (!ensureTeamAccess(scope, existing.teamId)) return forbidden();

    if (data.assigneeId) {
      const membership = await prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId: existing.teamId, userId: data.assigneeId } },
        select: { id: true },
      });
      if (!membership) return badRequest("Người phụ trách phải thuộc cùng team");
    }

    const nextStatus = data.status ?? existing.status;
    const statusChanged = nextStatus !== existing.status;
    const shouldSetResolvedAt =
      nextStatus === IncidentStatus.RESOLVED || nextStatus === IncidentStatus.CLOSED;

    const updated = await prisma.$transaction(async (tx) => {
      await tx.incident.update({
        where: { id },
        data: {
          ...(data.title !== undefined ? { title: data.title } : {}),
          ...(data.description !== undefined
            ? { description: normalizeNullableText(data.description) ?? null }
            : {}),
          ...(data.severity !== undefined ? { severity: data.severity } : {}),
          ...(data.status !== undefined ? { status: data.status } : {}),
          ...(data.occurredAt !== undefined ? { occurredAt: new Date(data.occurredAt) } : {}),
          ...(data.assigneeId !== undefined ? { assigneeId: data.assigneeId } : {}),
          ...(data.impactSummary !== undefined
            ? { impactSummary: normalizeNullableText(data.impactSummary) ?? null }
            : {}),
          ...(data.rootCause !== undefined
            ? { rootCause: normalizeNullableText(data.rootCause) ?? null }
            : {}),
          ...(data.actionItems !== undefined
            ? { actionItems: normalizeNullableText(data.actionItems) ?? null }
            : {}),
          ...(data.status !== undefined
            ? { resolvedAt: shouldSetResolvedAt ? new Date() : null }
            : {}),
        },
      });

      if (statusChanged) {
        await tx.incidentLifecycleEvent.create({
          data: {
            incidentId: id,
            fromStatus: existing.status,
            toStatus: nextStatus,
            changedById: user.id,
            note: data.lifecycleNote?.trim() || null,
          },
        });
      }

      return tx.incident.findUniqueOrThrow({
        where: { id },
        include: incidentInclude,
      });
    });

    return ok(updated);
  } catch (error) {
    return handleError(error);
  }
}
