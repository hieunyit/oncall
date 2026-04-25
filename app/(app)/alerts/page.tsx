import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { AlertStatus } from "@/app/generated/prisma/client";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { AlertActions } from "./alert-actions";

export const metadata = { title: "Alerts" };

interface PageProps {
  searchParams: Promise<{ status?: string; integrationId?: string }>;
}

const STATUS_LABELS: Record<string, string> = {
  FIRING: "Đang cháy",
  ACKNOWLEDGED: "Đã nhận",
  RESOLVED: "Đã giải quyết",
};

const STATUS_COLORS: Record<string, string> = {
  FIRING: "bg-red-100 text-red-700",
  ACKNOWLEDGED: "bg-yellow-100 text-yellow-700",
  RESOLVED: "bg-green-100 text-green-700",
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: "text-red-600",
  warning: "text-yellow-600",
  info: "text-blue-600",
};

export default async function AlertsPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, systemRole: true, teamMembers: { select: { teamId: true } } },
  });
  if (!currentUser) redirect("/login");

  const { status, integrationId } = await searchParams;
  const isAdmin = currentUser.systemRole === "ADMIN";
  const myTeamIds = currentUser.teamMembers.map((m) => m.teamId);

  const alerts = await prisma.alert.findMany({
    where: {
      ...(status ? { status: status as AlertStatus } : {}),
      ...(integrationId ? { integrationId } : {}),
      integration: isAdmin ? undefined : { teamId: { in: myTeamIds } },
    },
    include: {
      integration: { select: { id: true, name: true, team: { select: { id: true, name: true } } } },
      acknowledger: { select: { id: true, fullName: true } },
    },
    orderBy: { triggeredAt: "desc" },
    take: 100,
  });

  const firingCount = alerts.filter((a) => a.status === "FIRING").length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Alerts</h1>
          {firingCount > 0 && (
            <p className="text-sm text-red-600 mt-0.5 font-medium">{firingCount} alert đang cháy</p>
          )}
        </div>
        {/* Status filter */}
        <div className="flex items-center gap-2">
          {["", "FIRING", "ACKNOWLEDGED", "RESOLVED"].map((s) => (
            <a
              key={s}
              href={s ? `?status=${s}` : "?"}
              className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                (status ?? "") === s
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {s ? STATUS_LABELS[s] : "Tất cả"}
            </a>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {alerts.length === 0 ? (
          <p className="px-5 py-12 text-center text-gray-400 text-sm">Không có alert nào.</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {alerts.map((alert) => (
              <div key={alert.id} className="px-5 py-4 flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                    alert.status === "FIRING" ? "bg-red-500 animate-pulse" :
                    alert.status === "ACKNOWLEDGED" ? "bg-yellow-500" : "bg-green-500"
                  }`} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-gray-900 text-sm">{alert.title}</p>
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${STATUS_COLORS[alert.status]}`}>
                        {STATUS_LABELS[alert.status]}
                      </span>
                      {alert.severity && (
                        <span className={`text-xs font-medium uppercase ${SEVERITY_COLORS[alert.severity.toLowerCase()] ?? "text-gray-500"}`}>
                          {alert.severity}
                        </span>
                      )}
                    </div>
                    {alert.message && (
                      <p className="text-xs text-gray-500 mt-0.5 truncate">{alert.message}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                      <span>{alert.integration.team.name} · {alert.integration.name}</span>
                      <span>{format(alert.triggeredAt, "HH:mm dd/MM/yyyy", { locale: vi })}</span>
                      {alert.acknowledger && (
                        <span>Nhận bởi {alert.acknowledger.fullName}</span>
                      )}
                    </div>
                  </div>
                </div>
                <AlertActions alert={{ id: alert.id, status: alert.status }} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
