import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser, requireTeamRole, isNextResponse } from "@/lib/rbac";
import { ok, noContent, unauthorized, notFound, handleError } from "@/lib/api-response";
import { TeamRole } from "@/app/generated/prisma/client";

const UpdateRunbookSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().max(50000).optional(),
  keywords: z.array(z.string().max(100)).max(20).optional(),
  isActive: z.boolean().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const { id } = await params;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const runbook = await (prisma as any).runbook.findUnique({
      where: { id },
      include: {
        team: { select: { id: true, name: true } },
        createdBy: { select: { id: true, fullName: true } },
      },
    });
    if (!runbook) return notFound("Runbook not found");

    const result = await requireTeamRole(runbook.teamId, TeamRole.MEMBER);
    if (isNextResponse(result)) return result;

    return ok(runbook);
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const { id } = await params;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const runbook = await (prisma as any).runbook.findUnique({ where: { id } });
    if (!runbook) return notFound("Runbook not found");

    const result = await requireTeamRole(runbook.teamId, TeamRole.MANAGER);
    if (isNextResponse(result)) return result;

    const body = await req.json();
    const data = UpdateRunbookSchema.parse(body);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updated = await (prisma as any).runbook.update({
      where: { id },
      data,
      include: {
        team: { select: { id: true, name: true } },
        createdBy: { select: { id: true, fullName: true } },
      },
    });

    return ok(updated);
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const { id } = await params;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const runbook = await (prisma as any).runbook.findUnique({ where: { id } });
    if (!runbook) return notFound("Runbook not found");

    const result = await requireTeamRole(runbook.teamId, TeamRole.MANAGER);
    if (isNextResponse(result)) return result;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as any).runbook.delete({ where: { id } });
    return noContent();
  } catch (error) {
    return handleError(error);
  }
}
