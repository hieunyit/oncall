import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/rbac";
import { ok, badRequest, unauthorized, handleZodError } from "@/lib/api-response";

const schema = z.object({
  fullName: z.string().min(1).max(120).optional(),
  timezone: z.string().max(60).optional(),
  telegramChatId: z.string().max(40).nullable().optional(),
  teamsConversationId: z.string().max(200).nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
});

export async function GET() {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      id: true,
      email: true,
      fullName: true,
      timezone: true,
      telegramChatId: true,
      teamsConversationId: true,
      phone: true,
      systemRole: true,
      isActive: true,
      createdAt: true,
      teamMembers: {
        select: {
          role: true,
          team: { select: { id: true, name: true, slug: true } },
        },
      },
    },
  });

  return ok(dbUser);
}

export async function PATCH(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const body = await req.json().catch(() => null);
  if (!body) return badRequest("Invalid JSON");

  const parsed = schema.safeParse(body);
  if (!parsed.success) return handleZodError(parsed.error);

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: parsed.data,
    select: {
      id: true, email: true, fullName: true,
      timezone: true, telegramChatId: true,
      teamsConversationId: true, phone: true,
    },
  });

  return ok(updated);
}
