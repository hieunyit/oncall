import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { IntegrationCard } from "./integration-card";

export const metadata = { title: "Alert Integrations" };

export default async function IntegrationsPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, systemRole: true, teamMembers: { select: { role: true, teamId: true } } },
  });
  if (!currentUser) redirect("/login");

  const isAdmin = currentUser.systemRole === "ADMIN";
  const managedTeamIds = currentUser.teamMembers.filter((m) => m.role === "MANAGER").map((m) => m.teamId);

  const integrations = await prisma.alertIntegration.findMany({
    where: isAdmin ? {} : { teamId: { in: [...managedTeamIds, ...currentUser.teamMembers.map((m) => m.teamId)] } },
    include: {
      team: { select: { id: true, name: true } },
      _count: { select: { alerts: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const teams = isAdmin
    ? await prisma.team.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } })
    : await prisma.team.findMany({
        where: { members: { some: { userId: currentUser.id, role: "MANAGER" } } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });

  const canCreate = isAdmin || managedTeamIds.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Alert Integrations</h1>
          <p className="text-sm text-gray-500 mt-1">
            Nhận cảnh báo từ hệ thống giám sát (Grafana, Prometheus, webhook chung).
          </p>
        </div>
        {canCreate && (
          <Link
            href="/integrations/new"
            className="px-3.5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
          >
            + Tạo integration
          </Link>
        )}
      </div>

      {integrations.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-16 text-center">
          <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z"/>
            </svg>
          </div>
          <p className="text-gray-400 text-sm">Chưa có integration nào.</p>
          {canCreate && (
            <Link href="/integrations/new" className="mt-3 inline-block text-sm text-indigo-600 hover:text-indigo-700">
              Tạo integration đầu tiên →
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {integrations.map((integration) => (
            <IntegrationCard
              key={integration.id}
              integration={integration}
              canManage={isAdmin || managedTeamIds.includes(integration.teamId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
