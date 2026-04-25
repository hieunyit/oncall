import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { AlertStatus } from "@/app/generated/prisma/client";
import { formatDistanceToNow } from "date-fns";
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

const STATUS_BADGE: Record<string, string> = {
  FIRING: "bg-red-100 text-red-700 ring-1 ring-red-200",
  ACKNOWLEDGED: "bg-yellow-100 text-yellow-700 ring-1 ring-yellow-200",
  RESOLVED: "bg-green-100 text-green-700 ring-1 ring-green-200",
};

const STATUS_ROW_BORDER: Record<string, string> = {
  FIRING: "border-l-4 border-l-red-500",
  ACKNOWLEDGED: "border-l-4 border-l-yellow-400",
  RESOLVED: "border-l-4 border-l-green-500",
};

const SEVERITY_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-700 ring-1 ring-red-200",
  warning: "bg-yellow-100 text-yellow-700 ring-1 ring-yellow-200",
  info: "bg-blue-100 text-blue-700 ring-1 ring-blue-200",
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

  const FILTER_TABS = [
    { key: "", label: "Tất cả", href: "?" },
    { key: "FIRING",       label: STATUS_LABELS.FIRING,       href: "?status=FIRING",       activeClass: "bg-red-600 text-white border-red-600",       inactiveClass: "text-red-600 border-red-200 hover:bg-red-50" },
    { key: "ACKNOWLEDGED", label: STATUS_LABELS.ACKNOWLEDGED, href: "?status=ACKNOWLEDGED", activeClass: "bg-yellow-500 text-white border-yellow-500",   inactiveClass: "text-yellow-600 border-yellow-200 hover:bg-yellow-50" },
    { key: "RESOLVED",     label: STATUS_LABELS.RESOLVED,     href: "?status=RESOLVED",     activeClass: "bg-green-600 text-white border-green-600",     inactiveClass: "text-green-700 border-green-200 hover:bg-green-50" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Alerts</h1>
          {firingCount > 0 && (
            <div className="flex items-center gap-1.5 mt-1">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
              </span>
              <p className="text-sm text-red-600 font-semibold">{firingCount} alert đang cháy</p>
            </div>
          )}
        </div>

        {/* Status filter pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {FILTER_TABS.map((tab) => {
            const isActive = (status ?? "") === tab.key;
            const base = "text-xs px-3 py-1.5 rounded-full border font-medium transition-colors";
            const colorClass = isActive
              ? (tab.activeClass ?? "bg-indigo-600 text-white border-indigo-600")
              : (tab.inactiveClass ?? "border-gray-200 text-gray-600 hover:bg-gray-50");
            return (
              <a key={tab.key} href={tab.href} className={`${base} ${colorClass}`}>
                {tab.label}
              </a>
            );
          })}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {alerts.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-gray-400 text-sm">Không có alert nào.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className={`px-5 py-4 flex items-start justify-between gap-4 ${STATUS_ROW_BORDER[alert.status] ?? ""}`}
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${
                    alert.status === "FIRING" ? "bg-red-500 animate-pulse" :
                    alert.status === "ACKNOWLEDGED" ? "bg-yellow-500" : "bg-green-500"
                  }`} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-gray-900 text-sm">{alert.title}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[alert.status] ?? ""}`}>
                        {STATUS_LABELS[alert.status]}
                      </span>
                      {alert.severity && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium uppercase ${SEVERITY_BADGE[alert.severity.toLowerCase()] ?? "bg-gray-100 text-gray-600"}`}>
                          {alert.severity}
                        </span>
                      )}
                    </div>
                    {alert.message && (
                      <p className="text-xs text-gray-500 mt-0.5 truncate max-w-md">{alert.message}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400 flex-wrap">
                      <span className="font-medium text-gray-500">{alert.integration.team.name}</span>
                      <span>·</span>
                      <span>{alert.integration.name}</span>
                      <span>·</span>
                      <span title={alert.triggeredAt.toISOString()}>
                        {formatDistanceToNow(alert.triggeredAt, { addSuffix: true, locale: vi })}
                      </span>
                      {alert.acknowledger && (
                        <>
                          <span>·</span>
                          <span>Nhận bởi <span className="font-medium text-gray-600">{alert.acknowledger.fullName}</span></span>
                        </>
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
