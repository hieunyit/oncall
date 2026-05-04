"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";

type IncidentSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type IncidentStatus = "OPEN" | "INVESTIGATING" | "MITIGATED" | "RESOLVED" | "CLOSED";

const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  OPEN: "Mới mở",
  INVESTIGATING: "Đang điều tra",
  MITIGATED: "Đã giảm thiểu",
  RESOLVED: "Đã khắc phục",
  CLOSED: "Đóng",
};

const INCIDENT_SEVERITY_LABELS: Record<IncidentSeverity, string> = {
  LOW: "Thấp",
  MEDIUM: "Trung bình",
  HIGH: "Cao",
  CRITICAL: "Nghiêm trọng",
};

function toIncidentDayKey(date: Date, tz = "Asia/Ho_Chi_Minh"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

type IncidentAttachmentItem = {
  id: string;
  fileName: string;
  storagePath: string;
  contentType: string;
  sizeBytes: number;
  kind: "IMAGE" | "EXCEL";
  createdAt: string;
};

type IncidentLifecycleItem = {
  id: string;
  fromStatus: IncidentStatus | null;
  toStatus: IncidentStatus;
  note: string | null;
  createdAt: string;
  changedBy: { id: string; fullName: string };
};

type IncidentItem = {
  id: string;
  teamId: string;
  title: string;
  description: string | null;
  severity: IncidentSeverity;
  status: IncidentStatus;
  occurredAt: string;
  resolvedAt: string | null;
  createdAt: string;
  team: { id: string; name: string };
  policy: { id: string; name: string } | null;
  createdBy: { id: string; fullName: string };
  assignee: { id: string; fullName: string } | null;
  attachments: IncidentAttachmentItem[];
  lifecycleEvents: IncidentLifecycleItem[];
};

type TeamOption = { id: string; name: string };
type PolicyOption = { id: string; name: string; teamId: string };

interface Props {
  enabled: boolean;
  initialIncidents: IncidentItem[];
  rangeStartIso: string;
  rangeEndIso: string;
  defaultTeamId?: string;
  teams: TeamOption[];
  policies: PolicyOption[];
  timezone: string;
}

const ALL_STATUSES: IncidentStatus[] = [
  "OPEN",
  "INVESTIGATING",
  "MITIGATED",
  "RESOLVED",
  "CLOSED",
];

const ALL_SEVERITIES: IncidentSeverity[] = [
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
];

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
      return "bg-gray-100 text-gray-600";
  }
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
      return "bg-gray-100 text-gray-600";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

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

export function IncidentControlPanel({
  enabled,
  initialIncidents,
  rangeStartIso,
  rangeEndIso,
  defaultTeamId,
  teams,
  policies,
  timezone,
}: Props) {
  const [incidents, setIncidents] = useState<IncidentItem[]>(initialIncidents);
  const [selectedTeamId, setSelectedTeamId] = useState<string>(defaultTeamId ?? "");
  const [selectedDay, setSelectedDay] = useState<string>(toIncidentDayKey(new Date(), timezone));
  const [openCreate, setOpenCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusDraft, setStatusDraft] = useState<Record<string, IncidentStatus>>({});
  const [statusNoteDraft, setStatusNoteDraft] = useState<Record<string, string>>({});
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({
    teamId: defaultTeamId ?? teams[0]?.id ?? "",
    policyId: "",
    title: "",
    description: "",
    severity: "MEDIUM" as IncidentSeverity,
    occurredAt: toLocalDatetimeInputValue(new Date()),
  });
  const [createFiles, setCreateFiles] = useState<FileList | null>(null);

  async function refreshIncidents(teamId: string) {
    const params = new URLSearchParams({
      start: rangeStartIso,
      end: rangeEndIso,
    });
    if (teamId) params.set("teamId", teamId);
    const res = await fetch(`/api/incidents?${params.toString()}`);
    const payload = await res.json();
    if (!res.ok) {
      throw new Error(payload.error ?? "Không thể tải incident");
    }
    const incidentList = (payload.data?.incidents ?? payload.incidents ?? []) as IncidentItem[];
    setIncidents(incidentList);
  }

  const filteredIncidents = useMemo(
    () =>
      incidents.filter((incident) => !selectedTeamId || incident.teamId === selectedTeamId),
    [incidents, selectedTeamId]
  );

  const incidentsForDay = useMemo(
    () =>
      filteredIncidents.filter(
        (incident) => toIncidentDayKey(new Date(incident.occurredAt), timezone) === selectedDay
      ),
    [filteredIncidents, selectedDay, timezone]
  );

  const dayStats = useMemo(() => {
    const openCount = incidentsForDay.filter(
      (incident) =>
        incident.status === "OPEN" ||
        incident.status === "INVESTIGATING"
    ).length;
    const resolvedCount = incidentsForDay.filter(
      (incident) =>
        incident.status === "RESOLVED" ||
        incident.status === "CLOSED"
    ).length;
    const criticalCount = incidentsForDay.filter(
      (incident) => incident.severity === "CRITICAL"
    ).length;
    return {
      total: incidentsForDay.length,
      open: openCount,
      resolved: resolvedCount,
      critical: criticalCount,
    };
  }, [incidentsForDay]);

  const topDays = useMemo(() => {
    const map = new Map<string, number>();
    for (const incident of filteredIncidents) {
      const key = toIncidentDayKey(new Date(incident.occurredAt), timezone);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .slice(0, 14);
  }, [filteredIncidents, timezone]);

  const availablePolicies = useMemo(
    () => policies.filter((policy) => policy.teamId === createForm.teamId),
    [policies, createForm.teamId]
  );

  async function handleCreateIncident(e: React.FormEvent) {
    e.preventDefault();
    if (!createForm.teamId) return;

    setBusy(true);
    setError(null);
    try {
      const createRes = await fetch("/api/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId: createForm.teamId,
          policyId: createForm.policyId || null,
          title: createForm.title,
          description: createForm.description || undefined,
          severity: createForm.severity,
          occurredAt: new Date(createForm.occurredAt).toISOString(),
        }),
      });
      const createPayload = await createRes.json();
      if (!createRes.ok) {
        throw new Error(createPayload.error ?? "Không thể tạo incident");
      }

      const createdIncidentId =
        createPayload.data?.id ?? createPayload.id;
      if (!createdIncidentId) {
        throw new Error("Không lấy được incident id sau khi tạo");
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
          throw new Error(uploadPayload.error ?? "Tải file incident thất bại");
        }
      }

      await refreshIncidents(selectedTeamId);
      setOpenCreate(false);
      setCreateFiles(null);
      setCreateForm({
        teamId: createForm.teamId,
        policyId: "",
        title: "",
        description: "",
        severity: "MEDIUM",
        occurredAt: toLocalDatetimeInputValue(new Date()),
      });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Không thể tạo incident");
    } finally {
      setBusy(false);
    }
  }

  async function handleStatusUpdate(incident: IncidentItem) {
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
        throw new Error(payload.error ?? "Không thể cập nhật vòng đời");
      }
      await refreshIncidents(selectedTeamId);
      setStatusNoteDraft((prev) => ({ ...prev, [incident.id]: "" }));
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Không thể cập nhật incident");
    } finally {
      setUpdatingId(null);
    }
  }

  if (!enabled) {
    return (
      <section className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
        Module Incident chưa sẵn sàng vì database chưa migrate bảng mới. Chạy `npm run db:migrate`
        để bật tính năng.
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Incident Ops</h2>
          <p className="text-sm text-slate-500">
            Tạo incident từ lịch trực, quản lý vòng đời và theo dõi thống kê chi tiết theo ngày.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpenCreate(true)}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          + Tạo incident
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
            Chọn ngày
          </label>
          <input
            type="date"
            value={selectedDay}
            onChange={(e) => setSelectedDay(e.target.value)}
            className="input"
          />
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
            Lọc team
          </label>
          <select
            value={selectedTeamId}
            onChange={(e) => setSelectedTeamId(e.target.value)}
            className="input"
          >
            <option value="">Tất cả team</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </div>
        <StatCard label="Tổng incident/ngày" value={dayStats.total} />
        <StatCard label="Đang mở" value={dayStats.open} />
        <StatCard label="Critical" value={dayStats.critical} />
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.8fr_1fr]">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">
              Incident ngày {selectedDay.split("-").reverse().join("/")} ({incidentsForDay.length})
            </h3>
            <span className="text-xs text-slate-500">
              Resolved/CLOSED: {dayStats.resolved}
            </span>
          </div>

          {incidentsForDay.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
              Không có incident trong ngày đã chọn.
            </div>
          ) : (
            incidentsForDay.map((incident) => {
              const selectedStatus = statusDraft[incident.id] ?? incident.status;
              const note = statusNoteDraft[incident.id] ?? "";
              const isUpdating = updatingId === incident.id;
              return (
                <article
                  key={incident.id}
                  className="rounded-xl border border-slate-200 p-3 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h4 className="font-medium text-slate-900">{incident.title}</h4>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {format(new Date(incident.occurredAt), "HH:mm dd/MM/yyyy")} · {incident.team.name}
                        {incident.policy ? ` · ${incident.policy.name}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${severityBadgeClass(incident.severity)}`}>
                        {INCIDENT_SEVERITY_LABELS[incident.severity]}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(incident.status)}`}>
                        {INCIDENT_STATUS_LABELS[incident.status]}
                      </span>
                    </div>
                  </div>

                  {incident.description && (
                    <p className="mt-2 rounded-lg bg-slate-50 px-2.5 py-2 text-sm text-slate-700">
                      {incident.description}
                    </p>
                  )}

                  {incident.attachments.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {incident.attachments.map((file) => (
                        <a
                          key={file.id}
                          href={file.storagePath}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                        >
                          <span className="rounded bg-slate-100 px-1 py-0.5 text-[10px] font-semibold text-slate-600">
                            {file.kind}
                          </span>
                          <span className="max-w-[200px] truncate">{file.fileName}</span>
                          <span className="text-slate-400">({formatSize(file.sizeBytes)})</span>
                        </a>
                      ))}
                    </div>
                  )}

                  <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-[1fr_1fr_auto]">
                    <select
                      value={selectedStatus}
                      onChange={(e) =>
                        setStatusDraft((prev) => ({
                          ...prev,
                          [incident.id]: e.target.value as IncidentStatus,
                        }))
                      }
                      className="input text-sm"
                    >
                      {ALL_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {INCIDENT_STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>
                    <input
                      value={note}
                      onChange={(e) =>
                        setStatusNoteDraft((prev) => ({ ...prev, [incident.id]: e.target.value }))
                      }
                      placeholder="Ghi chú chuyển trạng thái..."
                      className="input text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => handleStatusUpdate(incident)}
                      disabled={isUpdating}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      {isUpdating ? "Đang lưu..." : "Cập nhật"}
                    </button>
                  </div>

                  {incident.lifecycleEvents.length > 0 && (
                    <div className="mt-2 border-t border-slate-100 pt-2">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">Vòng đời</p>
                      <div className="mt-1 space-y-1">
                        {incident.lifecycleEvents.slice(-4).map((event) => (
                          <p key={event.id} className="text-xs text-slate-600">
                            {format(new Date(event.createdAt), "HH:mm dd/MM")} ·{" "}
                            {event.fromStatus ? INCIDENT_STATUS_LABELS[event.fromStatus] : "Khởi tạo"} →{" "}
                            {INCIDENT_STATUS_LABELS[event.toStatus]} · {event.changedBy.fullName}
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
        </div>

        <aside className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <h3 className="text-sm font-semibold text-slate-800">Mật độ sự cố theo ngày</h3>
          <p className="text-xs text-slate-500">
            Hiển thị 14 ngày gần nhất trong kỳ đang xem.
          </p>
          <div className="space-y-1.5">
            {topDays.length === 0 && (
              <p className="text-xs text-slate-400">Không có dữ liệu incident.</p>
            )}
            {topDays.map(([dayKey, count]) => (
              <button
                key={dayKey}
                type="button"
                onClick={() => setSelectedDay(dayKey)}
                className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-1.5 text-left text-xs ${
                  selectedDay === dayKey
                    ? "border-slate-500 bg-white text-slate-900"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                }`}
              >
                <span>{dayKey.split("-").reverse().join("/")}</span>
                <span className="font-semibold">{count}</span>
              </button>
            ))}
          </div>
        </aside>
      </div>

      {openCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form
            onSubmit={handleCreateIncident}
            className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
          >
            <div className="mb-3 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Tạo incident mới</h3>
                <p className="text-sm text-slate-500">
                  Hỗ trợ đính kèm file Excel/CSV và ảnh ngay khi tạo.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpenCreate(false)}
                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
              >
                Đóng
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Team</label>
                <select
                  value={createForm.teamId}
                  onChange={(e) =>
                    setCreateForm((prev) => ({
                      ...prev,
                      teamId: e.target.value,
                      policyId: "",
                    }))
                  }
                  className="input"
                  required
                >
                  <option value="">Chọn team</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Chính sách</label>
                <select
                  value={createForm.policyId}
                  onChange={(e) =>
                    setCreateForm((prev) => ({ ...prev, policyId: e.target.value }))
                  }
                  className="input"
                >
                  <option value="">Không gắn policy</option>
                  {availablePolicies.map((policy) => (
                    <option key={policy.id} value={policy.id}>
                      {policy.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-medium text-slate-600">Tiêu đề</label>
                <input
                  value={createForm.title}
                  onChange={(e) =>
                    setCreateForm((prev) => ({ ...prev, title: e.target.value }))
                  }
                  className="input"
                  placeholder="Ví dụ: Lỗi API thanh toán gây timeout diện rộng"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Mức độ</label>
                <select
                  value={createForm.severity}
                  onChange={(e) =>
                    setCreateForm((prev) => ({
                      ...prev,
                      severity: e.target.value as IncidentSeverity,
                    }))
                  }
                  className="input"
                >
                  {ALL_SEVERITIES.map((severity) => (
                    <option key={severity} value={severity}>
                      {INCIDENT_SEVERITY_LABELS[severity]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Thời điểm xảy ra</label>
                <input
                  type="datetime-local"
                  value={createForm.occurredAt}
                  onChange={(e) =>
                    setCreateForm((prev) => ({ ...prev, occurredAt: e.target.value }))
                  }
                  className="input"
                  required
                />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-medium text-slate-600">Mô tả</label>
                <textarea
                  value={createForm.description}
                  onChange={(e) =>
                    setCreateForm((prev) => ({ ...prev, description: e.target.value }))
                  }
                  rows={3}
                  className="input"
                  placeholder="Tác động, triệu chứng, phạm vi ảnh hưởng..."
                />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Tệp đính kèm (Excel/CSV/Ảnh)
                </label>
                <input
                  type="file"
                  multiple
                  accept=".xls,.xlsx,.csv,image/*"
                  onChange={(e) => setCreateFiles(e.target.files)}
                  className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
                />
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpenCreate(false)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {busy ? "Đang tạo..." : "Tạo incident"}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}
