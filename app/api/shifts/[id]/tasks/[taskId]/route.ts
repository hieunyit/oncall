import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser, requireTeamRole, isNextResponse } from "@/lib/rbac";
import { ok, noContent, unauthorized, forbidden, notFound, handleError } from "@/lib/api-response";
import { TeamRole } from "@/app/generated/prisma/client";

const UpdateTaskSchema = z.object({
  isCompleted: z.boolean().optional(),
  title: z.string().min(1).max(500).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const { id, taskId } = await params;
    const shift = await prisma.shift.findUnique({
      where: { id },
      include: { policy: { select: { teamId: true } } },
    });
    if (!shift) return notFound("Shift not found");

    const result = await requireTeamRole(shift.policy.teamId, TeamRole.MEMBER);
    if (isNextResponse(result)) return result;

    const task = await prisma.shiftTask.findUnique({ where: { id: taskId } });
    if (!task || task.shiftId !== id) return notFound("Task not found");

    const body = await req.json();
    const data = UpdateTaskSchema.parse(body);

    // Only the shift assignee can check/uncheck tasks
    if (data.isCompleted !== undefined && actor.id !== shift.assigneeId) {
      return forbidden("Only the shift assignee can check tasks");
    }

    // Tasks can only be toggled within 2 hours before shift starts
    if (data.isCompleted !== undefined) {
      const now = new Date();
      const earliest = new Date(shift.startsAt.getTime() - 2 * 60 * 60 * 1000);
      if (now < earliest) {
        return forbidden("Checklist chỉ có thể cập nhật khi ca trực sắp bắt đầu hoặc đang diễn ra");
      }
    }

    const updated = await prisma.shiftTask.update({
      where: { id: taskId },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.isCompleted !== undefined && {
          isCompleted: data.isCompleted,
          completedAt: data.isCompleted ? new Date() : null,
        }),
      },
    });

    return ok(updated);
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const { id, taskId } = await params;
    const shift = await prisma.shift.findUnique({
      where: { id },
      include: { policy: { select: { teamId: true } } },
    });
    if (!shift) return notFound("Shift not found");

    const result = await requireTeamRole(shift.policy.teamId, TeamRole.MEMBER);
    if (isNextResponse(result)) return result;

    const task = await prisma.shiftTask.findUnique({ where: { id: taskId } });
    if (!task || task.shiftId !== id) return notFound("Task not found");

    await prisma.shiftTask.delete({ where: { id: taskId } });

    return noContent();
  } catch (error) {
    return handleError(error);
  }
}
