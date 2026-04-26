import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { vi } from "date-fns/locale";

export const metadata = { title: "Runbook" };

export default async function RunbooksPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, systemRole: true, teamMembers: { select: { teamId: true, role: true } } },
  });
  if (!currentUser) redirect("/login");

  const isAdmin = currentUser.systemRole === "ADMIN";
  const myTeamIds = currentUser.teamMembers.map((m) => m.teamId);
  const managedTeamIds = currentUser.teamMembers.filter((m) => m.role === "MANAGER").map((m) => m.teamId);
  const canCreate = isAdmin || managedTeamIds.length > 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runbooks = await (prisma as any).runbook.findMany({
    where: {
      isActive: true,
      ...(isAdmin ? {} : { teamId: { in: myTeamIds } }),
    },
    include: {
      team: { select: { id: true, name: true } },
      createdBy: { select: { id: true, fullName: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  // Group by team
  const byTeam = new Map<string, { teamName: string; items: typeof runbooks }>();
  for (const rb of runbooks) {
    if (!byTeam.has(rb.teamId)) byTeam.set(rb.teamId, { teamName: rb.team.name, items: [] });
    byTeam.get(rb.teamId)!.items.push(rb);
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Runbook</h1>
          <p className="text-sm text-gray-500 mt-0.5">Hướng dẫn xử lý sự cố theo từng nhóm trực</p>
        </div>
        {canCreate && (
          <Link
            href="/runbooks/new"
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/>
            </svg>
            Tạo runbook mới
          </Link>
        )}
      </div>

      {byTeam.size === 0 && (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
          <svg className="w-10 h-10 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
          </svg>
          <p className="text-gray-400 text-sm">Chưa có runbook nào.</p>
          {canCreate && (
            <Link href="/runbooks/new" className="mt-3 inline-block text-sm text-indigo-600 hover:underline">
              Tạo runbook đầu tiên →
            </Link>
          )}
        </div>
      )}

      {Array.from(byTeam.values()).map(({ teamName, items }) => (
        <section key={teamName} className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400 px-1">{teamName}</h2>
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {(items as any[]).map((rb) => (
              <Link
                key={rb.id}
                href={`/runbooks/${rb.id}`}
                className="flex items-start justify-between gap-4 px-5 py-4 hover:bg-gray-50 transition-colors group"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-900 group-hover:text-indigo-600 transition-colors truncate">
                    {rb.title}
                  </p>
                  {rb.keywords.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {(rb.keywords as string[]).slice(0, 5).map((kw) => (
                        <span key={kw} className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded font-mono">
                          {kw}
                        </span>
                      ))}
                      {rb.keywords.length > 5 && (
                        <span className="text-[10px] text-gray-400">+{rb.keywords.length - 5}</span>
                      )}
                    </div>
                  )}
                  <p className="text-xs text-gray-400 mt-1.5">
                    Cập nhật {format(rb.updatedAt, "dd/MM/yyyy HH:mm", { locale: vi })} bởi {rb.createdBy.fullName}
                  </p>
                </div>
                <svg className="w-4 h-4 text-gray-300 group-hover:text-indigo-400 shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
                </svg>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
