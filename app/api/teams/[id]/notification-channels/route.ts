import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser, requireTeamRole, isNextResponse } from "@/lib/rbac";
import { ok, created, noContent, badRequest, unauthorized, notFound, handleError } from "@/lib/api-response";
import { ChannelType, TeamRole } from "@/app/generated/prisma/client";

const ChannelSchema = z.object({
  type: z.nativeEnum(ChannelType),
  name: z.string().min(1).max(80),
  configJson: z.record(z.unknown()),
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
    const result = await requireTeamRole(id, TeamRole.MEMBER);
    if (isNextResponse(result)) return result;

    const channels = await prisma.teamNotificationChannel.findMany({
      where: { teamId: id },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    });
    return ok(channels);
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
    const result = await requireTeamRole(id, TeamRole.MANAGER);
    if (isNextResponse(result)) return result;

    const body = await req.json().catch(() => null);
    if (!body) return badRequest("Invalid JSON");

    const data = ChannelSchema.parse(body);
    const channel = await prisma.teamNotificationChannel.create({
      data: { teamId: id, ...data, isActive: data.isActive ?? true },
    });
    return created(channel);
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();

    const { id } = await params;
    const result = await requireTeamRole(id, TeamRole.MANAGER);
    if (isNextResponse(result)) return result;

    const { channelId } = await req.json().catch(() => ({}));
    if (!channelId) return badRequest("channelId required");

    const channel = await prisma.teamNotificationChannel.findUnique({ where: { id: channelId } });
    if (!channel || channel.teamId !== id) return notFound("Channel not found");

    await prisma.teamNotificationChannel.delete({ where: { id: channelId } });
    return noContent();
  } catch (error) {
    return handleError(error);
  }
}
