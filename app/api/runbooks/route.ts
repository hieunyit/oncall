import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser, requireTeamRole, isNextResponse } from "@/lib/rbac";
import { ok, created, unauthorized, handleError } from "@/lib/api-response";
import { TeamRole } from "@/app/generated/prisma/client";

const CreateRunbookSchema = z.object({
  teamId: z.string().uuid(),
  title: z.string().min(1).max(200),
  content: z.string().max(50000).default(""),
  keywords: z.array(z.string().max(100)).max(20).default([]),
});

export async function GET(req: NextRequest) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const { searchParams } = req.nextUrl;
    const teamId = searchParams.get("teamId");
    const q = searchParams.get("q")?.trim();

    const myTeamIds = (
      await prisma.teamMember.findMany({
        where: { userId: actor.id },
        select: { teamId: true },
      })
    ).map((m) => m.teamId);

    const isAdmin = actor.systemRole === "ADMIN";

    const runbooks = await prisma.runbook.findMany({
      where: {
        isActive: true,
        ...(teamId ? { teamId } : isAdmin ? {} : { teamId: { in: myTeamIds } }),
        ...(q
          ? {
              OR: [
                { title: { contains: q, mode: "insensitive" } },
                { keywords: { has: q } },
              ],
            }
          : {}),
      },
      include: {
        team: { select: { id: true, name: true } },
        createdBy: { select: { id: true, fullName: true } },
      },
      orderBy: { updatedAt: "desc" },
    });

    return ok(runbooks);
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const body = await req.json();
    const data = CreateRunbookSchema.parse(body);

    const result = await requireTeamRole(data.teamId, TeamRole.MANAGER);
    if (isNextResponse(result)) return result;

    const runbook = await prisma.runbook.create({
      data: {
        teamId: data.teamId,
        title: data.title,
        content: data.content,
        keywords: data.keywords,
        createdById: actor.id,
      },
      include: {
        team: { select: { id: true, name: true } },
        createdBy: { select: { id: true, fullName: true } },
      },
    });

    return created(runbook);
  } catch (error) {
    return handleError(error);
  }
}
