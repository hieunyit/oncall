import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { PolicyForm } from "@/components/policy/policy-form";

interface PageProps {
  searchParams: Promise<{ teamId?: string }>;
}

export default async function NewPolicyPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const { teamId } = await searchParams;

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, systemRole: true },
  });
  if (!currentUser) redirect("/login");

  const [teamsRaw, escalationPolicies] = await Promise.all([
    prisma.team.findMany({
      where:
        currentUser.systemRole === "ADMIN"
          ? {}
          : { members: { some: { userId: currentUser.id, role: "MANAGER" } } },
      select: {
        id: true,
        name: true,
        members: {
          include: {
            user: { select: { id: true, fullName: true, email: true } },
          },
          orderBy: { order: "asc" },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.escalationPolicy.findMany({
      where: { isActive: true },
      select: { id: true, name: true, teamId: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const teams = teamsRaw.map((team) => ({
    id: team.id,
    name: team.name,
    members: team.members.map((member) => member.user),
  }));

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Tạo chính sách xoay vòng</h1>
      <PolicyForm teams={teams} defaultTeamId={teamId} escalationPolicies={escalationPolicies} />
    </div>
  );
}
