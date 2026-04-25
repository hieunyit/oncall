import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/rbac";
import { ok, unauthorized, forbidden, badRequest, handleError } from "@/lib/api-response";
import { SystemRole } from "@/app/generated/prisma/client";

function parseKeycloakIssuer(issuer: string): { base: string; realm: string } | null {
  // e.g. https://auth.example.com/realms/myrealm
  const match = issuer.match(/^(https?:\/\/.+?)\/realms\/([^/]+)\/?$/);
  if (!match) return null;
  return { base: match[1], realm: match[2] };
}

async function getAdminToken(base: string, realm: string): Promise<string> {
  const clientId = process.env.KEYCLOAK_CLIENT_ID!;
  const clientSecret = process.env.KEYCLOAK_CLIENT_SECRET!;
  const tokenUrl = `${base}/realms/${realm}/protocol/openid-connect/token`;

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get admin token: ${text}`);
  }

  const data = await res.json();
  return data.access_token as string;
}

export async function GET(req: NextRequest) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();
    if (actor.systemRole !== SystemRole.ADMIN) return forbidden();

    const issuer = process.env.KEYCLOAK_ISSUER;
    if (!issuer) return badRequest("KEYCLOAK_ISSUER not configured");

    const parsed = parseKeycloakIssuer(issuer);
    if (!parsed) return badRequest("Cannot parse KEYCLOAK_ISSUER");

    const q = req.nextUrl.searchParams.get("q") ?? "";
    const token = await getAdminToken(parsed.base, parsed.realm);

    const url = new URL(`${parsed.base}/admin/realms/${parsed.realm}/users`);
    if (q) url.searchParams.set("search", q);
    url.searchParams.set("max", "20");

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Keycloak users API error: ${text}`);
    }

    const users = await res.json();
    const result = (users as Array<Record<string, unknown>>).map((u) => ({
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      enabled: u.enabled,
    }));

    return ok(result);
  } catch (error) {
    return handleError(error);
  }
}

const ImportSchema = z.object({
  keycloakId: z.string().min(1),
  email: z.string().email(),
  fullName: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const actor = await getSessionUser();
    if (!actor) return unauthorized();
    if (actor.systemRole !== SystemRole.ADMIN) return forbidden();

    const body = await req.json();
    const data = ImportSchema.parse(body);

    const user = await prisma.user.upsert({
      where: { email: data.email },
      update: { keycloakId: data.keycloakId, fullName: data.fullName },
      create: {
        email: data.email,
        fullName: data.fullName,
        keycloakId: data.keycloakId,
      },
    });

    return ok(user);
  } catch (error) {
    return handleError(error);
  }
}
