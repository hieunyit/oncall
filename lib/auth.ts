import NextAuth from "next-auth";
import KeycloakProvider from "next-auth/providers/keycloak";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

// Limit login session lifetime (defaults: 12h hard-expiry, no sliding extension)
const sessionMaxAgeHours = parsePositiveInt(
  process.env.AUTH_SESSION_MAX_AGE_HOURS,
  12
);
const sessionMaxAgeSeconds = sessionMaxAgeHours * 60 * 60;
const sessionUpdateAgeSeconds = parsePositiveInt(
  process.env.AUTH_SESSION_UPDATE_AGE_SECONDS,
  sessionMaxAgeSeconds
);

type AuthAdapter = ReturnType<typeof PrismaAdapter>;

function sanitizeBigInts<T>(value: T): T {
  if (typeof value === "bigint") {
    return value.toString() as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeBigInts(item)) as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = sanitizeBigInts(nested);
    }
    return out as T;
  }
  return value;
}

function makeBigIntSafeAdapter(adapter: AuthAdapter): AuthAdapter {
  return {
    ...adapter,
    createUser: adapter.createUser
      ? async (user) => sanitizeBigInts(await adapter.createUser!(user))
      : undefined,
    getUser: adapter.getUser
      ? async (id) => sanitizeBigInts(await adapter.getUser!(id))
      : undefined,
    getUserByEmail: adapter.getUserByEmail
      ? async (email) => sanitizeBigInts(await adapter.getUserByEmail!(email))
      : undefined,
    getUserByAccount: adapter.getUserByAccount
      ? async (account) => sanitizeBigInts(await adapter.getUserByAccount!(account))
      : undefined,
    updateUser: adapter.updateUser
      ? async (user) => sanitizeBigInts(await adapter.updateUser!(user))
      : undefined,
    getSessionAndUser: adapter.getSessionAndUser
      ? async (sessionToken) => {
          const row = await adapter.getSessionAndUser!(sessionToken);
          if (!row) return null;
          return {
            ...row,
            user: sanitizeBigInts(row.user),
          };
        }
      : undefined,
  };
}

const adapter = makeBigIntSafeAdapter(PrismaAdapter(prisma));

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter,
  providers: [
    KeycloakProvider({
      clientId: process.env.KEYCLOAK_CLIENT_ID!,
      clientSecret: process.env.KEYCLOAK_CLIENT_SECRET!,
      issuer: process.env.KEYCLOAK_ISSUER!,
      // Safe because Keycloak is the sole trusted identity provider;
      // allows pre-seeded users to sign in without a pre-linked Account row.
      allowDangerousEmailAccountLinking: true,
    }),
  ],
  session: {
    strategy: "database",
    maxAge: sessionMaxAgeSeconds,
    updateAge: sessionUpdateAgeSeconds,
  },
  callbacks: {
    async session({ session, user }) {
      if (session.user) {
        const dbUser = await prisma.user.findUnique({
          where: { email: user.email! },
          select: { id: true, systemRole: true, keycloakId: true, fullName: true },
        });
        if (dbUser) {
          session.user.id = dbUser.id;
          // @ts-expect-error extended session type
          session.user.systemRole = dbUser.systemRole;
          // @ts-expect-error extended session type
          session.user.keycloakId = dbUser.keycloakId;
          // @ts-expect-error extended session type
          session.user.fullName = dbUser.fullName;
        }
      }
      return session;
    },
    async signIn({ user, profile }) {
      if (!profile?.sub) return true;
      await prisma.user.upsert({
        where: { email: user.email! },
        update: {
          fullName: (profile.name as string) ?? user.name ?? user.email!,
          keycloakId: profile.sub,
        },
        create: {
          email: user.email!,
          fullName: (profile.name as string) ?? user.name ?? user.email!,
          keycloakId: profile.sub,
        },
      });
      return true;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
});
