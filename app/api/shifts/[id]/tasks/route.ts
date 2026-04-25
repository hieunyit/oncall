import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser, requireTeamRole, isNextResponse } from "@/lib/rbac";
import { ok, created, unauthorized, notFound, handleError } from "@/lib/api-response";
import { TeamRole } from "@/app/generated/prisma/client";

const CreateTaskSchema = z.object({
  title: z.string().min(1).max(500),
  order: z.number().int().min(0).optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const { id } = await params;
    const shift = await prisma.shift.findUnique({
      where: { id },
      include: { policy: { select: { teamId: true } } },
    });
    if (!shift) return notFound("Shift not found");

    const result = await requireTeamRole(shift.policy.teamId, TeamRole.MEMBER);
    if (isNextResponse(result)) return result;

    const tasks = await prisma.shiftTask.findMany({
      where: { shiftId: id },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    });

    return ok(tasks);
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const { id } = await params;
    const shift = await prisma.shift.findUnique({
      where: { id },
      include: { policy: { select: { teamId: true } } },
    });
    if (!shift) return notFound("Shift not found");

    const result = await requireTeamRole(shift.policy.teamId, TeamRole.MEMBER);
    if (isNextResponse(result)) return result;

    const body = await req.json();
    const data = CreateTaskSchema.parse(body);

    const task = await prisma.shiftTask.create({
      data: {
        shiftId: id,
        title: data.title,
        order: data.order ?? 0,
      },
    });

    return created(task);
  } catch (error) {
    return handleError(error);
  }
}
