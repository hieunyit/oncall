"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";

type IncidentSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type IncidentStatus = "OPEN" | "INVESTIGATING" | "MITIGATED" | "RESOLVED" | "CLOSED";

type IncidentAttachment = {
  id: string;
  fileName: string;
  storagePath: string;
  sizeBytes: number;
  kind: "IMAGE" | "EXCEL" | "PDF" | "WORD" | "TEXT";
};

type IncidentLifecycle = {
  id: string;
  fromStatus: IncidentStatus | null;
  toStatus: IncidentStatus;
  note: string | null;
  createdAt: string;
  changedBy: { id: string; fullName: string };
};

type IncidentItem = {
  id: string;
  title: string;
  description: string | null;
  impactSummary: string | null;
  rootCause: string | null;
  actionItems: string | null;
  severity: IncidentSeverity;
  status: IncidentStatus;
  occurredAt: string;
  assignee: { id: string; fullName: string } | null;
  attachments: IncidentAttachment[];
  lifecycleEvents: IncidentLifecycle[];
};

const STATUS_LABELS: Record<IncidentStatus, string> = {
  OPEN: "Moi mo",
  INVESTIGATING: "Dang dieu tra",
  MITIGATED: "Da giam thieu",
  RESOLVED: "Da khac phuc",
  CLOSED: "Dong",
};

const SEVERITY_LABELS: Record<IncidentSeverity, string> = {
  LOW: "Thap",
  MEDIUM: "Trung binh",
  HIGH: "Cao",
  CRITICAL: "Nghiem trong",
};

const ATTACHMENT_KIND_LABELS: Record<IncidentAttachment["kind"], string> = {
  IMAGE: "IMG",
  EXCEL: "XLS",
  PDF: "PDF",
  WORD: "DOC",
  TEXT: "TXT",
};

const STATUSES: IncidentStatus[] = ["OPEN", "INVESTIGATING", "MITIGATED", "RESOLVED", "CLOSED"];
const SEVERITIES: IncidentSeverity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

function formatSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 102.4) / 10} KB`;
  return `${Math.round(sizeBytes / 1024 / 102.4) / 10} MB`;
}

function toLocalDatetimeInputValue(date: Date): string {
  const copy = new Date(date);
  copy.setSeconds(0, 0);
  const offset = copy.getTimezoneOffset() * 60_000;
  return new Date(copy.getTime() - offset).toISOString().slice(0, 16);
}

function severityBadgeClass(severity: IncidentSeverity): string {
  switch (severity) {
    case "CRITICAL":
      return "bg-red-100 text-red-700";
    case "HIGH":
      return "bg-amber-100 text-amber-700";
    case "MEDIUM":
      return "bg-indigo-100 text-indigo-700";
    case "LOW":
      return "bg-slate-100 text-slate-600";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

function statusBadgeClass(status: IncidentStatus): string {
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
      return "bg-slate-100 text-slate-600";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

interface Props {
  shiftId: string;
  teamId: string;
  policyId: string;
  assigneeId: string;
  startsAt: Date;
  teamMembers: Array<{ id: string; fullName: string }>;
  canCreate: boolean;
  canManage: boolean;
}

export function ShiftIncidentsPanel({
  shiftId,
  teamId,
  policyId,
  assigneeId,
  startsAt,
  teamMembers,
  canCreate,
  canManage,
}: Props) {
  const [incidents, setIncidents] = useState<IncidentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openCreate, setOpenCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [createFiles, setCreateFiles] = useState<FileList | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [statusDraft, setStatusDraft] = useState<Record<string, IncidentStatus>>({});
  const [statusNoteDraft, setStatusNoteDraft] = useState<Record<string, string>>({});
  const [createForm, setCreateForm] = useState({
    title: "",
    severity: "MEDIUM" as IncidentSeverity,
    occurredAt: toLocalDatetimeInputValue(startsAt),
    description: "",
    impactSummary: "",
    rootCause: "",
    actionItems: "",
    assigneeId,
  });

  const fetchIncidents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ shiftId, limit: "200" });
      const res = await fetch(`/api/incidents?${params.toString()}`);
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error ?? "Khong the tai incident");
      }
      const incidentList = (payload.data?.incidents ?? payload.incidents ?? []) as IncidentItem[];
      setIncidents(incidentList);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Khong the tai incident");
      setIncidents([]);
    } finally {
      setLoading(false);
    }
  }, [shiftId]);

  useEffect(() => {
    void fetchIncidents();
  }, [fetchIncidents]);

  const stats = useMemo(() => {
    const open = incidents.filter(
      (incident) => incident.status === "OPEN" || incident.status === "INVESTIGATING"
    ).length;
    const critical = incidents.filter((incident) => incident.severity === "CRITICAL").length;
    return { total: incidents.length, open, critical };
  }, [incidents]);

  async function handleCreateIncident(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate || !createForm.title.trim()) return;

    setBusy(true);
    setError(null);
    try {
      const createRes = await fetch("/api/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId,
          policyId: policyId || null,
          shiftId,
          title: createForm.title.trim(),
          description: createForm.description.trim() || undefined,
          severity: createForm.severity,
          occurredAt: new Date(createForm.occurredAt).toISOString(),
          assigneeId: createForm.assigneeId || null,
          impactSummary: createForm.impactSummary.trim() || undefined,
          rootCause: createForm.rootCause.trim() || undefined,
          actionItems: createForm.actionItems.trim() || undefined,
        }),
      });
      const createPayload = await createRes.json();
      if (!createRes.ok) {
        throw new Error(createPayload.error ?? "Khong the tao incident");
      }

      const createdIncidentId = createPayload.data?.id ?? createPayload.id;
      if (!createdIncidentId) {
        throw new Error("Khong lay duoc incident id");
      }

      if (createFiles && createFiles.length > 0) {
        const formData = new FormData();
        Array.from(createFiles).forEach((file) => formData.append("files", file));
        const uploadRes = await fetch(`/api/incidents/${createdIncidentId}/attachments`, {
          method: "POST",
          body: formData,
        });
        const uploadPayload = await uploadRes.json();
        if (!uploadRes.ok) {
          throw new Error(uploadPayload.error ?? "Tai file incident that bai");
        }
      }

      setOpenCreate(false);
      setCreateFiles(null);
      setCreateForm({
        title: "",
        severity: "MEDIUM",
        occurredAt: toLocalDatetimeInputValue(startsAt),
        description: "",
        impactSummary: "",
        rootCause: "",
        actionItems: "",
        assigneeId,
      });
      await fetchIncidents();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Khong the tao incident");
    } finally {
      setBusy(false);
    }
  }

  async function handleStatusUpdate(incident: IncidentItem) {
    if (!canManage) return;
    const status = statusDraft[incident.id] ?? incident.status;
    const lifecycleNote = statusNoteDraft[incident.id]?.trim() ?? "";
    if (status === incident.status && lifecycleNote.length === 0) return;

    setUpdatingId(incident.id);
    setError(null);
    try {
      const res = await fetch(`/api/incidents/${incident.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          lifecycleNote: lifecycleNote || undefined,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error ?? "Khong the cap nhat incident");
      }
      await fetchIncidents();
      setStatusNoteDraft((prev) => ({ ...prev, [incident.id]: "" }));
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Khong the cap nhat incident");
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Incident theo ca truc</h3>
          <p className="text-xs text-slate-500">
            {stats.total} incident · {stats.open} dang mo · {stats.critical} critical
          </p>
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={() => setOpenCreate(true)}
            className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
          >
            + Tao incident
          </button>
        )}
      </div>

      {!canCreate && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-700">
          Chi nguoi dang truc ca nay moi duoc tao incident/report.
        </p>
      )}

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-xs text-slate-500">Dang tai incident...</p>
      ) : incidents.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-xs text-slate-500">
          Chua co incident nao gan voi ca truc nay.
        </div>
      ) : (
        <div className="space-y-2">
          {incidents.map((incident) => {
            const selectedStatus = statusDraft[incident.id] ?? incident.status;
            const note = statusNoteDraft[incident.id] ?? "";
            const isUpdating = updatingId === incident.id;
            return (
              <article key={incident.id} className="rounded-lg border border-slate-200 p-2.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{incident.title}</p>
                    <p className="text-[11px] text-slate-500">
                      {format(new Date(incident.occurredAt), "HH:mm dd/MM/yyyy")}
                      {incident.assignee ? ` · ${incident.assignee.fullName}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${severityBadgeClass(incident.severity)}`}>
                      {SEVERITY_LABELS[incident.severity]}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusBadgeClass(incident.status)}`}>
                      {STATUS_LABELS[incident.status]}
                    </span>
                  </div>
                </div>

                {incident.description && (
                  <p className="mt-2 rounded bg-slate-50 px-2 py-1.5 text-xs text-slate-700">
                    {incident.description}
                  </p>
                )}

                {(incident.impactSummary || incident.rootCause || incident.actionItems) && (
                  <div className="mt-2 grid grid-cols-1 gap-1.5 md:grid-cols-3">
                    <div className="rounded bg-slate-50 px-2 py-1.5 text-xs text-slate-700">
                      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        Impact
                      </p>
                      <p>{incident.impactSummary || "-"}</p>
                    </div>
                    <div className="rounded bg-slate-50 px-2 py-1.5 text-xs text-slate-700">
                      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        Root Cause
                      </p>
                      <p>{incident.rootCause || "-"}</p>
                    </div>
                    <div className="rounded bg-slate-50 px-2 py-1.5 text-xs text-slate-700">
                      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        Action Items
                      </p>
                      <p>{incident.actionItems || "-"}</p>
                    </div>
                  </div>
                )}

                {incident.attachments.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {incident.attachments.map((file) => (
                      <a
                        key={file.id}
                        href={file.storagePath}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50"
                      >
                        <span className="rounded bg-slate-100 px-1 py-0.5 text-[10px] font-semibold text-slate-600">
                          {ATTACHMENT_KIND_LABELS[file.kind]}
                        </span>
                        <span className="max-w-[180px] truncate">{file.fileName}</span>
                        <span className="text-slate-400">({formatSize(file.sizeBytes)})</span>
                      </a>
                    ))}
                  </div>
                )}

                {canManage && (
                  <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-[1fr_1fr_auto]">
                    <select
                      value={selectedStatus}
                      onChange={(e) =>
                        setStatusDraft((prev) => ({
                          ...prev,
                          [incident.id]: e.target.value as IncidentStatus,
                        }))
                      }
                      className="input text-xs"
                    >
                      {STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>
                    <input
                      value={note}
                      onChange={(e) =>
                        setStatusNoteDraft((prev) => ({ ...prev, [incident.id]: e.target.value }))
                      }
                      placeholder="Ghi chu chuyen trang thai..."
                      className="input text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => handleStatusUpdate(incident)}
                      disabled={isUpdating}
                      className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      {isUpdating ? "Dang luu..." : "Cap nhat"}
                    </button>
                  </div>
                )}

                {incident.lifecycleEvents.length > 0 && (
                  <div className="mt-2 border-t border-slate-100 pt-2">
                    <p className="text-[10px] uppercase tracking-wide text-slate-500">Vong doi</p>
                    <div className="mt-1 space-y-1">
                      {incident.lifecycleEvents.slice(-3).map((event) => (
                        <p key={event.id} className="text-[11px] text-slate-600">
                          {format(new Date(event.createdAt), "HH:mm dd/MM")} ·{" "}
                          {event.fromStatus ? STATUS_LABELS[event.fromStatus] : "Khoi tao"} {"->"}{" "}
                          {STATUS_LABELS[event.toStatus]} · {event.changedBy.fullName}
                          {event.note ? ` · ${event.note}` : ""}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {openCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form
            onSubmit={handleCreateIncident}
            className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-4 shadow-2xl"
          >
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-base font-semibold text-slate-900">Tao incident cho ca truc</h4>
              <button
                type="button"
                onClick={() => setOpenCreate(false)}
                className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
              >
                Dong
              </button>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-slate-600">Tieu de</label>
                <input
                  value={createForm.title}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, title: e.target.value }))}
                  className="input text-sm"
                  placeholder="Vi du: Loi API gay timeout dien rong"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Muc do</label>
                <select
                  value={createForm.severity}
                  onChange={(e) =>
                    setCreateForm((prev) => ({
                      ...prev,
                      severity: e.target.value as IncidentSeverity,
                    }))
                  }
                  className="input text-sm"
                >
                  {SEVERITIES.map((severity) => (
                    <option key={severity} value={severity}>
                      {SEVERITY_LABELS[severity]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Thoi diem xay ra</label>
                <input
                  type="datetime-local"
                  value={createForm.occurredAt}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, occurredAt: e.target.value }))}
                  className="input text-sm"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Nguoi phu trach</label>
                <select
                  value={createForm.assigneeId}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, assigneeId: e.target.value }))}
                  className="input text-sm"
                >
                  <option value="">Chua gan</option>
                  {teamMembers.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.fullName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-slate-600">Mo ta</label>
                <textarea
                  value={createForm.description}
                  onChange={(e) =>
                    setCreateForm((prev) => ({ ...prev, description: e.target.value }))
                  }
                  rows={3}
                  className="input text-sm"
                  placeholder="Tac dong, trieu chung, pham vi anh huong..."
                />
              </div>
              <div className="sm:col-span-2 grid grid-cols-1 gap-2 md:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Impact</label>
                  <textarea
                    value={createForm.impactSummary}
                    onChange={(e) =>
                      setCreateForm((prev) => ({ ...prev, impactSummary: e.target.value }))
                    }
                    rows={3}
                    className="input text-sm"
                    placeholder="Pham vi anh huong"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Root Cause</label>
                  <textarea
                    value={createForm.rootCause}
                    onChange={(e) =>
                      setCreateForm((prev) => ({ ...prev, rootCause: e.target.value }))
                    }
                    rows={3}
                    className="input text-sm"
                    placeholder="Nguyen nhan goc"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Action Items</label>
                  <textarea
                    value={createForm.actionItems}
                    onChange={(e) =>
                      setCreateForm((prev) => ({ ...prev, actionItems: e.target.value }))
                    }
                    rows={3}
                    className="input text-sm"
                    placeholder="Ke hoach xu ly"
                  />
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Tep dinh kem (Anh, Excel/CSV, PDF, Word, TXT)
                </label>
                <input
                  type="file"
                  multiple
                  accept=".xls,.xlsx,.csv,.pdf,.doc,.docx,.odt,.rtf,.txt,.log,.md,image/*"
                  onChange={(e) => setCreateFiles(e.target.files)}
                  className="block w-full text-xs text-slate-600 file:mr-2 file:rounded file:border-0 file:bg-slate-100 file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-200"
                />
              </div>
            </div>

            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpenCreate(false)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
              >
                Huy
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {busy ? "Dang tao..." : "Tao incident"}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
