import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/rbac";
import { ok, unauthorized, forbidden, handleError } from "@/lib/api-response";
import { DeliveryStatus, ChannelType, SystemRole } from "@/app/generated/prisma/client";

const QuerySchema = z.object({
  status: z.nativeEnum(DeliveryStatus).optional(),
  channelType: z.nativeEnum(ChannelType).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export async function GET(req: NextRequest) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();
    if (actor.systemRole !== SystemRole.ADMIN) return forbidden();

    const { searchParams } = req.nextUrl;
    const query = QuerySchema.parse(Object.fromEntries(searchParams));

    const where = {
      ...(query.status && { status: query.status }),
      ...(query.channelType && { channelType: query.channelType }),
    };

    const [deliveries, total] = await Promise.all([
      prisma.notificationDelivery.findMany({
        where,
        include: {
          message: {
            select: {
              eventType: true,
              templateId: true,
              channelType: true,
              createdAt: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.notificationDelivery.count({ where }),
    ]);

    return ok({ deliveries, total, page: query.page, limit: query.limit });
  } catch (error) {
    return handleError(error);
  }
}
