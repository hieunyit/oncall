import Link from "next/link";
import { endOfDay, format, startOfMonth } from "date-fns";
import { redirect } from "next/navigation";
import { IncidentSeverity, IncidentStatus } from "@/app/generated/prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { incidentInclude } from "@/lib/incidents/query";
import { buildIncidentWhere } from "@/lib/incidents/filters";
import {
  INCIDENT_SEVERITY_OPTIONS,
  INCIDENT_STATUS_OPTIONS,
} from "@/lib/incidents/text";
import { computeIncidentSlaSnapshot } from "@/lib/incidents/sla";

export const metadata = { title: "Incident Tổng Hợp" };

interface IncidentsPageProps {
  searchParams: Promise<{
    teamId?: string;
    policyId?: string;
    status?: IncidentStatus | "ALL";
    severity?: IncidentSeverity | "ALL";
    start?: string;
    end?: string;
    q?: string;
    page?: string;
    pageSize?: string;
  }>;
}

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

function parseDayStart(value?: string): Date | null {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function parseDayEnd(value?: string): Date | null {
  if (!value) return null;
  const parsed = new Date(`${value}T23:59:59.999`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function formatSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 102.4) / 10} KB`;
  return `${Math.round(sizeBytes / 1024 / 102.4) / 10} MB`;
}

function badgeClassForSeverity(severity: IncidentSeverity): string {
  switch (severity) {
    case "CRITICAL":
      return "bg-red-100 text-red-700";
    case "HIGH":
      return "bg-amber-100 text-amber-700";
    case "MEDIUM":
      return "bg-indigo-100 text-indigo-700";
    case "LOW":
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function badgeClassForStatus(status: IncidentStatus): string {
  switch (status) {
    case "OPEN":
      return "bg-rose-100 text-rose-700";
    case "INVESTIGATING":
      return "bg-orange-100 text-orange-700";
    case "MITIGATED":
      return "bg-blue-100 text-blue-700";
    case "RESOLVED":
      return "bg-emerald-100 text-emerald-700";
    case "CLOSED":
    default:
      return "bg-slate-100 text-slate-700";
  }
}

const ATTACHMENT_KIND_LABELS = {
  IMAGE: "IMG",
  EXCEL: "XLS",
  PDF: "PDF",
  WORD: "DOC",
  TEXT: "TXT",
} as const;

export default async function IncidentsPage({ searchParams }: IncidentsPageProps) {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: {
      id: true,
      systemRole: true,
      teamMembers: { select: { teamId: true } },
    },
  });
  if (!currentUser) redirect("/login");

  const {
    teamId: teamFilterParam,
    policyId: policyFilterParam,
    status: statusParam,
    severity: severityParam,
    start: startParam,
    end: endParam,
    q: qParam,
    page: pageParam,
    pageSize: pageSizeParam,
  } = await searchParams;

  const isAdmin = currentUser.systemRole === "ADMIN";
  const myTeamIds = currentUser.teamMembers.map((m) => m.teamId);
  const allowedTeamIds = isAdmin ? undefined : myTeamIds;

  const teams = await prisma.team.findMany({
    where: isAdmin ? {} : { id: { in: myTeamIds } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const selectedTeamId = teamFilterParam && teams.some((t) => t.id === teamFilterParam)
    ? teamFilterParam
    : "";

  const policies = await prisma.rotationPolicy.findMany({
    where: {
      isActive: true,
      ...(selectedTeamId
        ? { teamId: selectedTeamId }
        : isAdmin
          ? {}
          : { teamId: { in: myTeamIds } }),
    },
    select: { id: true, name: true, teamId: true },
    orderBy: [{ teamId: "asc" }, { name: "asc" }],
  });

  const selectedPolicyId = policyFilterParam && policies.some((p) => p.id === policyFilterParam)
    ? policyFilterParam
    : "";

  const statusFilter =
    statusParam &&
    statusParam !== "ALL" &&
    INCIDENT_STATUS_OPTIONS.some((s) => s.value === statusParam)
      ? statusParam
      : undefined;

  const severityFilter =
    severityParam &&
    severityParam !== "ALL" &&
    INCIDENT_SEVERITY_OPTIONS.some((s) => s.value === severityParam)
      ? severityParam
      : undefined;

  const rangeStart = parseDayStart(startParam) ?? startOfMonth(new Date());
  const rangeEnd = parseDayEnd(endParam) ?? endOfDay(new Date());
  const keyword = qParam?.trim() ?? "";
  const requestedPage =
    Number.isFinite(Number(pageParam)) && Number(pageParam) > 0
      ? Math.floor(Number(pageParam))
      : 1;
  const requestedPageSizeRaw = Number(pageSizeParam);
  const pageSize = PAGE_SIZE_OPTIONS.includes(requestedPageSizeRaw as any)
    ? requestedPageSizeRaw
    : 50;

  const incidentWhere = buildIncidentWhere({
    rangeStart,
    rangeEnd,
    selectedTeamId,
    isAdmin,
    allowedTeamIds,
    selectedPolicyId,
    statusFilter,
    severityFilter,
    keyword,
  });

  const [totalCount, statusCounts, severityCounts] = await Promise.all([
    prisma.incident.count({ where: incidentWhere }),
    prisma.incident.groupBy({
      by: ["status"],
      where: incidentWhere,
      _count: { id: true },
    }),
    prisma.incident.groupBy({
      by: ["severity"],
      where: incidentWhere,
      _count: { id: true },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const skip = (page - 1) * pageSize;

  const incidents = await prisma.incident.findMany({
    where: incidentWhere,
    include: incidentInclude,
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    skip,
    take: pageSize,
  });

  const statusCountMap = Object.fromEntries(
    statusCounts.map((row) => [row.status, row._count.id])
  ) as Record<IncidentStatus, number>;
  const severityCountMap = Object.fromEntries(
    severityCounts.map((row) => [row.severity, row._count.id])
  ) as Record<IncidentSeverity, number>;

  const total = totalCount;
  const openCount =
    (statusCountMap.OPEN ?? 0) + (statusCountMap.INVESTIGATING ?? 0);
  const criticalCount = severityCountMap.CRITICAL ?? 0;
  const resolvedCount =
    (statusCountMap.RESOLVED ?? 0) + (statusCountMap.CLOSED ?? 0);
  const overdueSlaCount = incidents.filter((incident) => {
    const snapshot = computeIncidentSlaSnapshot({
      severity: incident.severity,
      status: incident.status,
      occurredAt: incident.occurredAt,
      resolvedAt: incident.resolvedAt,
      lifecycleEvents: incident.lifecycleEvents.map((event) => ({
        toStatus: event.toStatus,
        createdAt: event.createdAt,
      })),
    });
    return snapshot.acknowledgedBreached || snapshot.resolvedBreached;
  }).length;

  const baseQueryParams = new URLSearchParams();
  if (selectedTeamId) baseQueryParams.set("teamId", selectedTeamId);
  if (selectedPolicyId) baseQueryParams.set("policyId", selectedPolicyId);
  if (statusFilter) baseQueryParams.set("status", statusFilter);
  if (severityFilter) baseQueryParams.set("severity", severityFilter);
  if (startParam) baseQueryParams.set("start", startParam);
  if (endParam) baseQueryParams.set("end", endParam);
  if (keyword) baseQueryParams.set("q", keyword);
  if (pageSize !== 50) baseQueryParams.set("pageSize", String(pageSize));

  const buildPageHref = (targetPage: number) => {
    const params = new URLSearchParams(baseQueryParams.toString());
    params.set("page", String(targetPage));
    return `/incidents?${params.toString()}`;
  };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Tổng hợp Incident</h1>
            <p className="mt-1 text-sm text-slate-500">
              Theo dõi incident theo ca trực và report chi tiết.
            </p>
          </div>
          <Link
            href="/schedule"
            className="inline-flex h-10 items-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Về lịch trực
          </Link>
        </div>

        <form method="GET" className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-6">
          <input type="hidden" name="page" value="1" />
          <select name="teamId" defaultValue={selectedTeamId} className="input lg:col-span-1">
            <option value="">Tất cả team</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>

          <select name="policyId" defaultValue={selectedPolicyId} className="input lg:col-span-1">
            <option value="">Tất cả chính sách</option>
            {policies
              .filter((policy) => !selectedTeamId || policy.teamId === selectedTeamId)
              .map((policy) => (
                <option key={policy.id} value={policy.id}>
                  {policy.name}
                </option>
              ))}
          </select>

          <select name="status" defaultValue={statusFilter ?? "ALL"} className="input lg:col-span-1">
            {INCIDENT_STATUS_OPTIONS.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>

          <select
            name="severity"
            defaultValue={severityFilter ?? "ALL"}
            className="input lg:col-span-1"
          >
            {INCIDENT_SEVERITY_OPTIONS.map((severity) => (
              <option key={severity.value} value={severity.value}>
                {severity.label}
              </option>
            ))}
          </select>

          <input
            type="date"
            name="start"
            defaultValue={format(rangeStart, "yyyy-MM-dd")}
            className="input lg:col-span-1"
          />
          <input
            type="date"
            name="end"
            defaultValue={format(rangeEnd, "yyyy-MM-dd")}
            className="input lg:col-span-1"
          />

          <input
            type="text"
            name="q"
            defaultValue={keyword}
            placeholder="Tìm tiêu đề/mô tả/report..."
            className="input lg:col-span-4"
          />
          <select
            name="pageSize"
            defaultValue={String(pageSize)}
            className="input lg:col-span-1"
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size} / trang
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Lọc dữ liệu
          </button>
        </form>

        <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-5">
          <SummaryCard label="Tổng Incident" value={total} />
          <SummaryCard label="Đang Mở" value={openCount} />
          <SummaryCard label="Critical" value={criticalCount} />
          <SummaryCard label="Đã Xử Lý" value={resolvedCount} />
          <SummaryCard label="SLA Quá Hạn (trang)" value={overdueSlaCount} />
        </div>
      </section>

      <section className="space-y-3">
        {incidents.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">
            Không có incident trong bộ lọc đã chọn.
          </div>
        ) : (
          incidents.map((incident) => {
            const slaSnapshot = computeIncidentSlaSnapshot({
              severity: incident.severity,
              status: incident.status,
              occurredAt: incident.occurredAt,
              resolvedAt: incident.resolvedAt,
              lifecycleEvents: incident.lifecycleEvents.map((event) => ({
                toStatus: event.toStatus,
                createdAt: event.createdAt,
              })),
            });
            const slaBreached =
              slaSnapshot.acknowledgedBreached || slaSnapshot.resolvedBreached;

            return (
              <article key={incident.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold text-slate-900">{incident.title}</h2>
                    <p className="mt-1 text-xs text-slate-500">
                      {format(incident.occurredAt, "HH:mm dd/MM/yyyy")} · {incident.team.name}
                      {incident.policy ? ` · ${incident.policy.name}` : ""}
                      {incident.assignee ? ` · ${incident.assignee.fullName}` : ""}
                    </p>
                    {incident.shift && (
                      <p className="mt-0.5 text-xs text-slate-500">
                        Ca: {format(incident.shift.startsAt, "HH:mm dd/MM")} - {format(incident.shift.endsAt, "HH:mm dd/MM")}
                      </p>
                    )}
                    <p className="mt-0.5 text-xs text-slate-500">
                      SLA ack: {format(slaSnapshot.acknowledgeDeadlineAt, "HH:mm dd/MM")} · SLA resolve:{" "}
                      {format(slaSnapshot.resolveDeadlineAt, "HH:mm dd/MM")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badgeClassForSeverity(incident.severity)}`}>
                      {incident.severity}
                    </span>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badgeClassForStatus(incident.status)}`}>
                      {incident.status}
                    </span>
                    {slaBreached && (
                      <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-medium text-rose-700">
                        SLA trễ
                      </span>
                    )}
                  </div>
                </div>

                {incident.description && (
                  <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{incident.description}</p>
                )}

                {(incident.impactSummary || incident.rootCause || incident.actionItems) && (
                  <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
                    <ReportBox title="Impact" value={incident.impactSummary} />
                    <ReportBox title="Root Cause" value={incident.rootCause} />
                    <ReportBox title="Action Items" value={incident.actionItems} />
                  </div>
                )}

                {incident.attachments.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {incident.attachments.map((file) => (
                      <a
                        key={file.id}
                        href={file.storagePath}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                      >
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                          {ATTACHMENT_KIND_LABELS[file.kind]}
                        </span>
                        <span className="max-w-[220px] truncate">{file.fileName}</span>
                        <span className="text-slate-400">({formatSize(file.sizeBytes)})</span>
                      </a>
                    ))}
                  </div>
                )}

                {incident.lifecycleEvents.length > 0 && (
                  <div className="mt-3 border-t border-slate-100 pt-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Vòng Đời</p>
                    <div className="mt-1 space-y-1">
                      {incident.lifecycleEvents.slice(-5).map((event) => (
                        <p key={event.id} className="text-xs text-slate-600">
                          {format(event.createdAt, "HH:mm dd/MM")} · {event.fromStatus ?? "INIT"} {"->"} {event.toStatus} · {event.changedBy.fullName}
                          {event.note ? ` · ${event.note}` : ""}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </article>
            );
          })
        )}

        {totalCount > 0 && (
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
            <p>
              Trang <span className="font-semibold text-slate-900">{page}</span> /{" "}
              <span className="font-semibold text-slate-900">{totalPages}</span> ·{" "}
              {totalCount} incident
            </p>
            <div className="flex items-center gap-2">
              {page > 1 ? (
                <Link
                  href={buildPageHref(page - 1)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-50"
                >
                  Trang trước
                </Link>
              ) : (
                <span className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-400">
                  Trang trước
                </span>
              )}
              {page < totalPages ? (
                <Link
                  href={buildPageHref(page + 1)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-50"
                >
                  Trang sau
                </Link>
              ) : (
                <span className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-400">
                  Trang sau
                </span>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function ReportBox({ title, value }: { title: string; value: string | null }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <p>{value?.trim() || "-"}</p>
    </div>
  );
}
