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

  const teams = await prisma.team.findMany({
    where:
      currentUser.systemRole === "ADMIN"
        ? {}
        : { members: { some: { userId: currentUser.id, role: "MANAGER" } } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Tạo chính sách xoay vòng</h1>
      <PolicyForm teams={teams} defaultTeamId={teamId} />
    </div>
  );
}
