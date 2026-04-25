import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/rbac";
import { ok, unauthorized, forbidden, handleError } from "@/lib/api-response";
import { SystemRole } from "@/app/generated/prisma/client";

const ListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  active: z.enum(["true", "false"]).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();
    if (actor.systemRole !== SystemRole.ADMIN) return forbidden();

    const { searchParams } = req.nextUrl;
    const query = ListQuerySchema.parse(Object.fromEntries(searchParams));

    const where = {
      ...(query.search && {
        OR: [
          { email: { contains: query.search, mode: "insensitive" as const } },
          { fullName: { contains: query.search, mode: "insensitive" as const } },
        ],
      }),
      ...(query.active !== undefined && { isActive: query.active === "true" }),
    };

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          fullName: true,
          systemRole: true,
          timezone: true,
          isActive: true,
          createdAt: true,
          _count: { select: { teamMembers: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.user.count({ where }),
    ]);

    return ok({ users, total, page: query.page, limit: query.limit });
  } catch (error) {
    return handleError(error);
  }
}
