import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { RunbookActions } from "./runbook-actions";

export default async function RunbookDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, systemRole: true, teamMembers: { select: { teamId: true, role: true } } },
  });
  if (!currentUser) redirect("/login");

  const { id } = await params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runbook = await (prisma as any).runbook.findUnique({
    where: { id },
    include: {
      team: { select: { id: true, name: true } },
      createdBy: { select: { id: true, fullName: true } },
    },
  });
  if (!runbook) notFound();

  const isAdmin = currentUser.systemRole === "ADMIN";
  const myMembership = currentUser.teamMembers.find((m) => m.teamId === runbook.teamId);
  if (!isAdmin && !myMembership) redirect("/runbooks");

  const canEdit = isAdmin || myMembership?.role === "MANAGER";

  const myTeams = canEdit
    ? await prisma.team.findMany({
        where: isAdmin ? {} : { id: { in: currentUser.teamMembers.filter((m) => m.role === "MANAGER").map((m) => m.teamId) } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      })
    : [];

  return (
    <div className="max-w-3xl space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/runbooks" className="hover:text-gray-700">Runbook</Link>
        <span>/</span>
        <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded">{runbook.team.name}</span>
        <span>/</span>
        <span className="text-gray-900 font-medium truncate">{runbook.title}</span>
      </div>

      {/* Header */}
      <div className="flex items-start gap-4 justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-gray-900 leading-snug">{runbook.title}</h1>
          <p className="text-xs text-gray-400 mt-1.5">
            Cập nhật {format(runbook.updatedAt, "HH:mm dd/MM/yyyy", { locale: vi })}
            {" · "}Tạo bởi {runbook.createdBy.fullName}
          </p>
          {runbook.keywords.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {(runbook.keywords as string[]).map((kw) => (
                <span key={kw} className="text-[11px] px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded font-mono border border-indigo-100">
                  {kw}
                </span>
              ))}
            </div>
          )}
        </div>
        {canEdit && (
          <RunbookActions
            runbookId={id}
            initialTitle={runbook.title}
            initialContent={runbook.content}
            initialKeywords={runbook.keywords}
            initialTeamId={runbook.teamId}
            teams={myTeams}
          />
        )}
      </div>

      {/* Content */}
      <div className="bg-white rounded-xl border border-gray-200 px-6 py-5">
        {runbook.content ? (
          <pre className="whitespace-pre-wrap text-sm text-gray-800 font-sans leading-relaxed">
            {runbook.content}
          </pre>
        ) : (
          <p className="text-gray-400 text-sm italic">Chưa có nội dung hướng dẫn.</p>
        )}
      </div>
    </div>
  );
}
