import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { RunbookForm } from "../runbook-form";

export const metadata = { title: "Tạo Runbook" };

export default async function NewRunbookPage({
  searchParams,
}: {
  searchParams: Promise<{ teamId?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, systemRole: true, teamMembers: { select: { teamId: true, role: true } } },
  });
  if (!currentUser) redirect("/login");

  const isAdmin = currentUser.systemRole === "ADMIN";
  const managedTeamIds = currentUser.teamMembers.filter((m) => m.role === "MANAGER").map((m) => m.teamId);

  if (!isAdmin && managedTeamIds.length === 0) redirect("/runbooks");

  const { teamId: defaultTeamId } = await searchParams;

  const myTeams = await prisma.team.findMany({
    where: isAdmin ? {} : { id: { in: managedTeamIds } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Tạo runbook mới</h1>
        <p className="text-sm text-gray-500 mt-0.5">Tài liệu hướng dẫn xử lý sự cố cho nhóm</p>
      </div>
      <RunbookForm teams={myTeams} defaultTeamId={defaultTeamId} />
    </div>
  );
}
