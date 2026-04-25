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

  const ROLE_LABEL: Record<string, string> = {
    MANAGER: "Quản lý",
    MEMBER: "Thành viên",
  };

  const ROLE_COLOR: Record<string, string> = {
    MANAGER: "bg-indigo-100 text-indigo-700",
    MEMBER: "bg-gray-100 text-gray-600",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Nhóm</h1>
          <p className="text-sm text-gray-500 mt-0.5">{teams.length} nhóm</p>
        </div>
        {currentUser.systemRole === "ADMIN" && (
          <Link
            href="/teams/new"
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
          >
            + Tạo nhóm
          </Link>
        )}
      </div>

      {teams.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-16 text-center">
          <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <p className="text-gray-400 text-sm">Bạn chưa thuộc nhóm nào.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {teams.map((team) => {
            const myRole = team.members[0]?.role;
            return (
              <Link
                key={team.id}
                href={`/teams/${team.id}`}
                className="bg-white rounded-xl border border-gray-200 p-5 hover:border-indigo-300 hover:shadow-md transition-all flex flex-col gap-4 group"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="font-semibold text-gray-900 group-hover:text-indigo-700 transition-colors truncate">
                      {team.name}
                    </h2>
                    {team.description && (
                      <p className="text-sm text-gray-500 mt-1 line-clamp-2">{team.description}</p>
                    )}
                  </div>
                  {myRole && (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${ROLE_COLOR[myRole] ?? "bg-gray-100 text-gray-600"}`}>
                      {ROLE_LABEL[myRole] ?? myRole}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3 pt-3 border-t border-gray-50">
                  <div className="flex items-center gap-1.5 text-sm text-gray-500">
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span className="font-medium text-gray-700">{team._count.members}</span>
                    <span>thành viên</span>
                  </div>
                  <span className="text-gray-200">·</span>
                  <div className="flex items-center gap-1.5 text-sm text-gray-500">
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span className="font-medium text-gray-700">{team._count.rotationPolicies}</span>
                    <span>chính sách</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
