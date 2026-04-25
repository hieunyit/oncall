import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/rbac";
import { ok, badRequest, unauthorized, handleError } from "@/lib/api-response";
import { ChannelType, NotificationUrgency } from "@/app/generated/prisma/client";

const RuleSchema = z.object({
  urgency: z.nativeEnum(NotificationUrgency),
  stepOrder: z.number().int().min(1),
  channelType: z.nativeEnum(ChannelType),
  delayMinutes: z.number().int().min(0).max(120),
  isActive: z.boolean().optional(),
});

const UpsertSchema = z.object({
  urgency: z.nativeEnum(NotificationUrgency),
  rules: z.array(RuleSchema),
});

export async function GET() {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const rules = await prisma.userNotificationRule.findMany({
      where: { userId: actor.id },
      orderBy: [{ urgency: "asc" }, { stepOrder: "asc" }],
    });

    return ok(rules);
  } catch (error) {
    return handleError(error);
  }
}

// PUT replaces all rules for a given urgency level
export async function PUT(req: NextRequest) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const body = await req.json().catch(() => null);
    if (!body) return badRequest("Invalid JSON");

    const { urgency, rules } = UpsertSchema.parse(body);

    const saved = await prisma.$transaction(async (tx) => {
      await tx.userNotificationRule.deleteMany({
        where: { userId: actor.id, urgency },
      });
      await tx.userNotificationRule.createMany({
        data: rules.map((r) => ({
          userId: actor.id,
          urgency: r.urgency,
          stepOrder: r.stepOrder,
          channelType: r.channelType,
          delayMinutes: r.delayMinutes,
          isActive: r.isActive ?? true,
        })),
      });
      return tx.userNotificationRule.findMany({
        where: { userId: actor.id },
        orderBy: [{ urgency: "asc" }, { stepOrder: "asc" }],
      });
    });

    return ok(saved);
  } catch (error) {
    return handleError(error);
  }
}
