import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/rbac";
import { ok, unauthorized, forbidden, handleError } from "@/lib/api-response";
import { ShiftStatus, SystemRole } from "@/app/generated/prisma/client";

const ListQuerySchema = z.object({
  policyId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  assigneeId: z.string().uuid().optional(),
  status: z.nativeEnum(ShiftStatus).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function GET(req: NextRequest) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const { searchParams } = req.nextUrl;
    const query = ListQuerySchema.parse(Object.fromEntries(searchParams));
    const isAdmin = actor.systemRole === SystemRole.ADMIN;

    const myTeamIds = isAdmin
      ? []
      : (
          await prisma.teamMember.findMany({
            where: { userId: actor.id },
            select: { teamId: true },
          })
        ).map((m) => m.teamId);

    if (query.teamId && !isAdmin && !myTeamIds.includes(query.teamId)) {
      return forbidden();
    }

    const where = {
      ...(query.policyId && { policyId: query.policyId }),
      ...(query.assigneeId && { assigneeId: query.assigneeId }),
      ...(query.status && { status: query.status }),
      ...(query.from && { startsAt: { gte: new Date(query.from) } }),
      ...(query.to && { endsAt: { lte: new Date(query.to) } }),
      ...(query.teamId && { policy: { teamId: query.teamId } }),
      ...(!isAdmin && !query.teamId && { policy: { teamId: { in: myTeamIds } } }),
    };

    const [shifts, total] = await Promise.all([
      prisma.shift.findMany({
        where,
        include: {
          assignee: { select: { id: true, email: true, fullName: true } },
          backup: { select: { id: true, email: true, fullName: true } },
          confirmation: { select: { status: true, dueAt: true } },
        },
        orderBy: { startsAt: "asc" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.shift.count({ where }),
    ]);

    return ok({ shifts, total, page: query.page, limit: query.limit });
  } catch (error) {
    return handleError(error);
  }
}
