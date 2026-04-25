import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/rbac";
import { ok, created, unauthorized, badRequest, handleError } from "@/lib/api-response";
import { SwapStatus } from "@/app/generated/prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { addDays } from "date-fns";

const CreateSwapSchema = z.object({
  originalShiftId: z.string().uuid(),
  targetUserId: z.string().uuid(),
  targetShiftId: z.string().uuid().optional(),
  requesterNote: z.string().max(500).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const { searchParams } = req.nextUrl;
    const status = searchParams.get("status") as SwapStatus | null;
    const page = Number(searchParams.get("page") ?? 1);
    const limit = Math.min(Number(searchParams.get("limit") ?? 20), 100);

    const where = {
      OR: [
        { requesterId: actor.id },
        { targetUserId: actor.id },
      ],
      ...(status && { status }),
    };

    const [swaps, total] = await Promise.all([
      prisma.swapRequest.findMany({
        where,
        include: {
          requester: { select: { id: true, fullName: true, email: true } },
          targetUser: { select: { id: true, fullName: true, email: true } },
          originalShift: { select: { id: true, startsAt: true, endsAt: true } },
          targetShift: { select: { id: true, startsAt: true, endsAt: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.swapRequest.count({ where }),
    ]);

    return ok({ swaps, total, page, limit });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, RATE_LIMITS.WRITE);
  if (limited) return limited;

  const idempotencyKey = req.headers.get("Idempotency-Key");

  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const body = await req.json();
    const data = CreateSwapSchema.parse(body);

    if (data.targetUserId === actor.id) {
      return badRequest("Cannot swap with yourself");
    }

    // Verify original shift belongs to actor
    const originalShift = await prisma.shift.findUnique({
      where: { id: data.originalShiftId },
    });
    if (!originalShift || originalShift.assigneeId !== actor.id) {
      return badRequest("Original shift not found or not assigned to you");
    }

    // Idempotency
    if (idempotencyKey) {
      const existing = await prisma.swapRequest.findUnique({
        where: { idempotencyKey },
      });
      if (existing) return created(existing);
    }

    const swap = await prisma.swapRequest.create({
      data: {
        requesterId: actor.id,
        targetUserId: data.targetUserId,
        originalShiftId: data.originalShiftId,
        targetShiftId: data.targetShiftId,
        requesterNote: data.requesterNote,
        expiresAt: addDays(new Date(), 7),
        idempotencyKey: idempotencyKey ?? undefined,
      },
    });

    await writeAuditLog({
      actorId: actor.id,
      entityType: "SwapRequest",
      entityId: swap.id,
      action: "CREATE",
      newValue: swap,
      ipAddress: req.headers.get("x-forwarded-for") ?? undefined,
    });

    return created(swap);
  } catch (error) {
    return handleError(error);
  }
}
