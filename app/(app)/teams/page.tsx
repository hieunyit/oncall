import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function TeamsPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, systemRole: true },
  });

  if (!currentUser) redirect("/login");

  const teams = await prisma.team.findMany({
    where:
      currentUser.systemRole === "ADMIN"
        ? {}
        : { members: { some: { userId: currentUser.id } } },
    include: {
      _count: { select: { members: true, rotationPolicies: true } },
      members: {
        where: { userId: currentUser.id },
        select: { role: true },
      },
    },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Nhóm</h1>
        {currentUser.systemRole === "ADMIN" && (
          <Link
            href="/teams/new"
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700"
          >
            + Tạo nhóm
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {teams.map((team) => (
          <Link
            key={team.id}
            href={`/teams/${team.id}`}
            className="bg-white rounded-xl border border-gray-200 p-5 hover:border-blue-300 hover:shadow-sm transition-all"
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-semibold text-gray-900">{team.name}</h2>
                {team.description && (
                  <p className="text-sm text-gray-500 mt-1 line-clamp-2">{team.description}</p>
                )}
              </div>
              {team.members[0] && (
                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                  {team.members[0].role}
                </span>
              )}
            </div>
            <div className="mt-4 flex gap-4 text-sm text-gray-500">
              <span>👥 {team._count.members} thành viên</span>
              <span>🔄 {team._count.rotationPolicies} chính sách</span>
            </div>
          </Link>
        ))}

        {teams.length === 0 && (
          <div className="col-span-3 text-center py-12 text-gray-500">
            Bạn chưa thuộc nhóm nào.
          </div>
        )}
      </div>
    </div>
  );
}
