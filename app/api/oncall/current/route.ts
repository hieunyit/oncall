import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/rbac";
import { ok, unauthorized, handleError } from "@/lib/api-response";
import { ShiftStatus } from "@/app/generated/prisma/client";

export async function GET() {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const now = new Date();

    const activeShifts = await prisma.shift.findMany({
      where: {
        startsAt: { lte: now },
        endsAt: { gte: now },
        status: { in: [ShiftStatus.PUBLISHED, ShiftStatus.ACTIVE] },
        overrideForShiftId: null,
      },
      include: {
        assignee: { select: { id: true, fullName: true, email: true, telegramChatId: true } },
        backup: { select: { id: true, fullName: true, email: true } },
        policy: {
          select: {
            id: true,
            name: true,
            team: { select: { id: true, name: true } },
          },
        },
        overrides: {
          where: {
            startsAt: { lte: now },
            endsAt: { gte: now },
            status: { in: [ShiftStatus.PUBLISHED, ShiftStatus.ACTIVE] },
          },
          include: {
            assignee: { select: { id: true, fullName: true, email: true } },
          },
          take: 1,
        },
      },
      orderBy: { startsAt: "asc" },
    });

    return ok(activeShifts);
  } catch (error) {
    return handleError(error);
  }
}
