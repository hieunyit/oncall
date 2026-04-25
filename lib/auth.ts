import NextAuth from "next-auth";
import KeycloakProvider from "next-auth/providers/keycloak";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
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
  session: { strategy: "database" },
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
