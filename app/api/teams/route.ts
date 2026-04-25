import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/rbac";
import { ok, created, unauthorized, forbidden, handleError } from "@/lib/api-response";
import { SystemRole } from "@/app/generated/prisma/client";
import { writeAuditLog } from "@/lib/audit";

const CreateTeamSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  slackChannel: z.string().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const { searchParams } = req.nextUrl;
    const page = Number(searchParams.get("page") ?? 1);
    const limit = Math.min(Number(searchParams.get("limit") ?? 20), 100);

    const where =
      actor.systemRole === SystemRole.ADMIN
        ? {}
        : { members: { some: { userId: actor.id } } };

    const [teams, total] = await Promise.all([
      prisma.team.findMany({
        where,
        include: {
          _count: { select: { members: true } },
          members: {
            where: { userId: actor.id },
            select: { role: true },
          },
        },
        orderBy: { name: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.team.count({ where }),
    ]);

    return ok({ teams, total, page, limit });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();
    if (actor.systemRole !== SystemRole.ADMIN) return forbidden();

    const body = await req.json();
    const data = CreateTeamSchema.parse(body);

    const team = await prisma.team.create({ data });

    await writeAuditLog({
      actorId: actor.id,
      entityType: "Team",
      entityId: team.id,
      action: "CREATE",
      newValue: team,
      ipAddress: req.headers.get("x-forwarded-for") ?? undefined,
    });

    return created(team);
  } catch (error) {
    return handleError(error);
  }
}
