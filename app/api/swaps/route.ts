import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/rbac";
import { ok, created, unauthorized, badRequest, handleError } from "@/lib/api-response";
import { SwapStatus, ShiftStatus } from "@/app/generated/prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { addDays } from "date-fns";

const CreateSwapSchema = z.object({
  originalShiftId: z.string().uuid(),
  // null = open request (anyone can take); uuid = targeted at specific person
  targetUserId: z.string().uuid().nullable().optional(),
  targetShiftId: z.string().uuid().optional(),
  requesterNote: z.string().max(500).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const { searchParams } = req.nextUrl;
    const status = searchParams.get("status") as SwapStatus | null;
    const mode = searchParams.get("mode"); // "available" = open swaps from teammates
    const page = Number(searchParams.get("page") ?? 1);
    const limit = Math.min(Number(searchParams.get("limit") ?? 20), 100);

    let where: object;

    if (mode === "available") {
      // Open swap requests from teammates (excluding own)
      const myTeamIds = (
        await prisma.teamMember.findMany({
          where: { userId: actor.id },
          select: { teamId: true },
        })
      ).map((m) => m.teamId);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      where = {
        status: SwapStatus.REQUESTED,
        targetUserId: null as any,       // nullable after migration 5
        requesterId: { not: actor.id },
        expiresAt: { gt: new Date() },
        originalShift: {
          policy: { teamId: { in: myTeamIds } },
        },
      };
    } else {
      where = {
        OR: [
          { requesterId: actor.id },
          { targetUserId: actor.id },
        ],
        ...(status && { status }),
      };
    }

    const [swaps, total] = await Promise.all([
      prisma.swapRequest.findMany({
        where,
        include: {
          requester: { select: { id: true, fullName: true, email: true } },
          targetUser: { select: { id: true, fullName: true, email: true } },
          originalShift: {
            include: { policy: { select: { name: true, teamId: true } } },
          },
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

    if (data.targetUserId && data.targetUserId === actor.id) {
      return badRequest("Cannot swap with yourself");
    }

    // Verify original shift belongs to actor
    const originalShift = await prisma.shift.findUnique({
      where: { id: data.originalShiftId },
      include: { policy: { select: { teamId: true } } },
    });
    if (!originalShift || originalShift.assigneeId !== actor.id) {
      return badRequest("Original shift not found or not assigned to you");
    }
    const swappableStatuses: ShiftStatus[] = [ShiftStatus.PUBLISHED, ShiftStatus.ACTIVE];
    if (!swappableStatuses.includes(originalShift.status)) {
      return badRequest("Original shift is not swappable");
    }

    if (data.targetShiftId && !data.targetUserId) {
      return badRequest("targetShiftId requires targetUserId");
    }

    if (data.targetUserId) {
      const membership = await prisma.teamMember.findFirst({
        where: { teamId: originalShift.policy.teamId, userId: data.targetUserId },
        select: { id: true },
      });
      if (!membership) {
        return badRequest("Target user must be a member of the same team");
      }
    }

    if (data.targetShiftId) {
      const targetShift = await prisma.shift.findUnique({
        where: { id: data.targetShiftId },
        include: { policy: { select: { teamId: true } } },
      });
      if (!targetShift) return badRequest("Target shift not found");
      if (targetShift.id === originalShift.id) return badRequest("Target shift must be different from original shift");
      if (targetShift.assigneeId !== data.targetUserId) {
        return badRequest("Target shift must belong to target user");
      }
      if (targetShift.policy.teamId !== originalShift.policy.teamId) {
        return badRequest("Target shift must be in the same team");
      }
      if (!swappableStatuses.includes(targetShift.status)) {
        return badRequest("Target shift is not swappable");
      }
    }

    // Idempotency
    if (idempotencyKey) {
      const existing = await prisma.swapRequest.findUnique({
        where: { idempotencyKey },
      });
      if (existing) return created(existing);
    }

    const swap = await prisma.swapRequest.create({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        requesterId: actor.id,
        ...(data.targetUserId != null && { targetUserId: data.targetUserId }),
        originalShiftId: data.originalShiftId,
        targetShiftId: data.targetShiftId,
        requesterNote: data.requesterNote,
        expiresAt: addDays(new Date(), 7),
        idempotencyKey: idempotencyKey ?? undefined,
      } as any,
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
