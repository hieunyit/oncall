import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser, requireTeamRole, isNextResponse } from "@/lib/rbac";
import { ok, unauthorized, notFound, badRequest, handleError } from "@/lib/api-response";
import { TeamRole } from "@/app/generated/prisma/client";
import { generateShifts, TimeSlot } from "@/lib/rotation/engine";
import { addWeeks } from "date-fns";

const PreviewQuerySchema = z.object({
  weeks: z.coerce.number().int().min(1).max(12).default(4),
  startDate: z.string().datetime().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const { id } = await params;
    const policy = await prisma.rotationPolicy.findUnique({
      where: { id },
      include: {
        team: {
          include: {
            members: {
              include: {
                user: { select: { id: true, email: true, fullName: true } },
              },
              orderBy: { order: "asc" },
            },
          },
        },
      },
    });

    if (!policy) return notFound("Policy not found");

    const result = await requireTeamRole(policy.teamId, TeamRole.MEMBER);
    if (isNextResponse(result)) return result;

    const { searchParams } = req.nextUrl;
    const query = PreviewQuerySchema.parse(Object.fromEntries(searchParams));

    if (policy.team.members.length === 0) {
      return badRequest("Team has no members");
    }

    const rangeStart = query.startDate ? new Date(query.startDate) : new Date();
    const rangeEnd = addWeeks(rangeStart, query.weeks);

    const participants = policy.team.members.map((m) => ({
      userId: m.user.id,
      backupId: undefined,
    }));

    const shifts = generateShifts(
      { ...policy, timeSlots: policy.timeSlots as TimeSlot[] | null | undefined },
      participants,
      rangeStart,
      rangeEnd
    );

    const memberMap = Object.fromEntries(
      policy.team.members.map((m) => [m.user.id, m.user])
    );

    const preview = shifts.map((s) => ({
      ...s,
      assignee: memberMap[s.assigneeId],
    }));

    return ok({ preview, totalShifts: shifts.length, rangeStart, rangeEnd });
  } catch (error) {
    return handleError(error);
  }
}
