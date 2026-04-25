import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/rbac";
import { ok, unauthorized, handleError } from "@/lib/api-response";
import { AlertStatus } from "@/app/generated/prisma/client";

export async function GET(req: NextRequest) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const status = req.nextUrl.searchParams.get("status") as AlertStatus | null;
    const teamId = req.nextUrl.searchParams.get("teamId");
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "50"), 200);

    const alerts = await prisma.alert.findMany({
      where: {
        ...(status ? { status } : {}),
        integration: teamId ? { teamId } : undefined,
      },
      include: {
        integration: { select: { id: true, name: true, team: { select: { id: true, name: true } } } },
        acknowledger: { select: { id: true, fullName: true } },
      },
      orderBy: { triggeredAt: "desc" },
      take: limit,
    });

    return ok(alerts);
  } catch (error) {
    return handleError(error);
  }
}
