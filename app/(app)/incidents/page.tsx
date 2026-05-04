import Link from "next/link";
import { endOfDay, format, startOfMonth } from "date-fns";
import { redirect } from "next/navigation";
import { IncidentSeverity, IncidentStatus } from "@/app/generated/prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { incidentInclude } from "@/lib/incidents/query";

export const metadata = { title: "Incident Tong Hop" };

interface IncidentsPageProps {
  searchParams: Promise<{
    teamId?: string;
    policyId?: string;
    status?: IncidentStatus | "ALL";
    severity?: IncidentSeverity | "ALL";
    start?: string;
    end?: string;
    q?: string;
  }>;
}

const STATUS_OPTIONS: Array<{ value: IncidentStatus | "ALL"; label: string }> = [
  { value: "ALL", label: "Tat ca trang thai" },
  { value: "OPEN", label: "Moi mo" },
  { value: "INVESTIGATING", label: "Dang dieu tra" },
  { value: "MITIGATED", label: "Da giam thieu" },
  { value: "RESOLVED", label: "Da khac phuc" },
  { value: "CLOSED", label: "Dong" },
];

const SEVERITY_OPTIONS: Array<{ value: IncidentSeverity | "ALL"; label: string }> = [
  { value: "ALL", label: "Tat ca muc do" },
  { value: "LOW", label: "Thap" },
  { value: "MEDIUM", label: "Trung binh" },
  { value: "HIGH", label: "Cao" },
  { value: "CRITICAL", label: "Nghiem trong" },
];

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
    statusParam && statusParam !== "ALL" && STATUS_OPTIONS.some((s) => s.value === statusParam)
      ? statusParam
      : undefined;

  const severityFilter =
    severityParam && severityParam !== "ALL" && SEVERITY_OPTIONS.some((s) => s.value === severityParam)
      ? severityParam
      : undefined;

  const rangeStart = parseDayStart(startParam) ?? startOfMonth(new Date());
  const rangeEnd = parseDayEnd(endParam) ?? endOfDay(new Date());
  const keyword = qParam?.trim() ?? "";

  const incidents = await prisma.incident.findMany({
    where: {
      occurredAt: { gte: rangeStart, lte: rangeEnd },
      ...(selectedTeamId
        ? { teamId: selectedTeamId }
        : isAdmin
          ? {}
          : { teamId: { in: allowedTeamIds } }),
      ...(selectedPolicyId ? { policyId: selectedPolicyId } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(severityFilter ? { severity: severityFilter } : {}),
      ...(keyword
        ? {
            OR: [
              { title: { contains: keyword, mode: "insensitive" } },
              { description: { contains: keyword, mode: "insensitive" } },
              { impactSummary: { contains: keyword, mode: "insensitive" } },
              { rootCause: { contains: keyword, mode: "insensitive" } },
              { actionItems: { contains: keyword, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: incidentInclude,
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    take: 800,
  });

  const total = incidents.length;
  const openCount = incidents.filter((i) => i.status === "OPEN" || i.status === "INVESTIGATING").length;
  const criticalCount = incidents.filter((i) => i.severity === "CRITICAL").length;
  const resolvedCount = incidents.filter((i) => i.status === "RESOLVED" || i.status === "CLOSED").length;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Tong hop Incident</h1>
            <p className="mt-1 text-sm text-slate-500">
              Theo doi incident theo ca truc, vong doi xu ly va report chi tiet.
            </p>
          </div>
          <Link
            href="/schedule"
            className="inline-flex h-10 items-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Ve lich truc
          </Link>
        </div>

        <form method="GET" className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-6">
          <select name="teamId" defaultValue={selectedTeamId} className="input lg:col-span-1">
            <option value="">Tat ca team</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>

          <select name="policyId" defaultValue={selectedPolicyId} className="input lg:col-span-1">
            <option value="">Tat ca chinh sach</option>
            {policies
              .filter((policy) => !selectedTeamId || policy.teamId === selectedTeamId)
              .map((policy) => (
                <option key={policy.id} value={policy.id}>
                  {policy.name}
                </option>
              ))}
          </select>

          <select name="status" defaultValue={statusFilter ?? "ALL"} className="input lg:col-span-1">
            {STATUS_OPTIONS.map((status) => (
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
            {SEVERITY_OPTIONS.map((severity) => (
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
            placeholder="Tim tieu de/mo ta/report..."
            className="input lg:col-span-5"
          />
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Loc du lieu
          </button>
        </form>

        <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
          <SummaryCard label="Tong Incident" value={total} />
          <SummaryCard label="Dang Mo" value={openCount} />
          <SummaryCard label="Critical" value={criticalCount} />
          <SummaryCard label="Da Xu Ly" value={resolvedCount} />
        </div>
      </section>

      <section className="space-y-3">
        {incidents.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">
            Khong co incident trong bo loc da chon.
          </div>
        ) : (
          incidents.map((incident) => (
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
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badgeClassForSeverity(incident.severity)}`}>
                    {incident.severity}
                  </span>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badgeClassForStatus(incident.status)}`}>
                    {incident.status}
                  </span>
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
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Vong Doi</p>
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
          ))
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
