"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  policyId: string;
  policyName: string;
}

interface ManualRow {
  id: string;
  assigneeId: string;
  startsAt: string;
  endsAt: string;
}

interface PolicyContext {
  members: Array<{ id: string; fullName: string; email: string }>;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function toDatetimeLocal(d: Date): string {
  const copy = new Date(d);
  copy.setSeconds(0, 0);
  const tzOffsetMs = copy.getTimezoneOffset() * 60_000;
  return new Date(copy.getTime() - tzOffsetMs).toISOString().slice(0, 16);
}

function makeRow(startsAt: Date, endsAt: Date): ManualRow {
  return {
    id: `${startsAt.getTime()}-${endsAt.getTime()}-${Math.random()}`,
    assigneeId: "",
    startsAt: toDatetimeLocal(startsAt),
    endsAt: toDatetimeLocal(endsAt),
  };
}

export function PublishBatchForm({ policyId, policyName: _policyName }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [mode, setMode] = useState<"AUTO" | "MANUAL">("AUTO");

  const today = new Date();
  const fourWeeksLater = new Date(today);
  fourWeeksLater.setDate(fourWeeksLater.getDate() + 28);

  const [rangeStart, setRangeStart] = useState(toDateStr(today));
  const [rangeEnd, setRangeEnd] = useState(toDateStr(fourWeeksLater));

  const [policyContext, setPolicyContext] = useState<PolicyContext | null>(null);
  const [loadingPolicyContext, setLoadingPolicyContext] = useState(false);
  const [manualRows, setManualRows] = useState<ManualRow[]>([]);

  const manualMembers = policyContext?.members ?? [];

  const canSubmitManual = useMemo(() => {
    return manualRows.length > 0 && manualRows.every((row) => row.assigneeId && row.startsAt && row.endsAt);
  }, [manualRows]);

  async function loadPolicyContext(): Promise<PolicyContext | null> {
    if (policyContext) return policyContext;
    if (loadingPolicyContext) return null;

    setLoadingPolicyContext(true);
    setError(null);

    try {
      const res = await fetch(`/api/policies/${policyId}`, { method: "GET" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Failed to load policy members.");
        return null;
      }

      const policy = json.data ?? json;
      const selectedIds = Array.isArray(policy.participantUserIds) ? (policy.participantUserIds as string[]) : [];
      const selectedSet = new Set(selectedIds);
      const teamMembersRaw = Array.isArray(policy.team?.members) ? policy.team.members : [];
      const teamMembers = teamMembersRaw
        .map((member: { user?: { id?: string; fullName?: string; email?: string } }) => member.user)
        .filter(
          (
            user: { id?: string; fullName?: string; email?: string } | undefined
          ): user is { id: string; fullName: string; email: string } =>
            Boolean(user?.id && user.fullName && user.email)
        );
      const filteredMembers =
        selectedSet.size === 0
          ? teamMembers
          : teamMembers.filter((member: { id: string }) => selectedSet.has(member.id));

      const context = { members: filteredMembers };
      setPolicyContext(context);
      return context;
    } finally {
      setLoadingPolicyContext(false);
    }
  }

  async function generateManualRowsFromPolicy() {
    const context = (await loadPolicyContext()) ?? policyContext;
    setError(null);

    if (!context || context.members.length === 0) {
      setManualRows([]);
      setError("Chính sách chưa có thành viên áp dụng.");
      return;
    }

    const start = new Date(`${rangeStart}T00:00:00`);
    const end = new Date(`${rangeEnd}T23:59:59`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      setError("Khoảng ngày không hợp lệ.");
      return;
    }

    const msPerDay = 24 * 60 * 60 * 1000;
    const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / msPerDay));
    const weeks = Math.max(1, Math.ceil(days / 7));

    const previewRes = await fetch(
      `/api/policies/${policyId}/preview?startDate=${encodeURIComponent(start.toISOString())}&weeks=${weeks}&pruneConflicts=false`
    );
    const previewJson = await previewRes.json().catch(() => ({}));
    if (!previewRes.ok) {
      setError(previewJson.error ?? "Không thể sinh danh sách ca từ policy.");
      return;
    }

    const previewItems = Array.isArray(previewJson.data?.preview) ? previewJson.data.preview : [];
    const normalizedRows: ManualRow[] = previewItems
      .map((item: { startsAt: string; endsAt: string }) => ({
        startsAt: new Date(item.startsAt),
        endsAt: new Date(item.endsAt),
      }))
      .filter((item: { startsAt: Date }) => item.startsAt >= start && item.startsAt <= end)
      .sort((a: { startsAt: Date }, b: { startsAt: Date }) => a.startsAt.getTime() - b.startsAt.getTime())
      .map((item: { startsAt: Date; endsAt: Date }) => makeRow(item.startsAt, item.endsAt));

    if (normalizedRows.length === 0) {
      setError("Không có ca nào trong khoảng ngày đã chọn.");
      setManualRows([]);
      return;
    }

    setManualRows((previousRows) => {
      const previousSelection = new Map(
        previousRows.map((row) => [`${row.startsAt}|${row.endsAt}`, row.assigneeId])
      );
      return normalizedRows.map((row) => ({
        ...row,
        assigneeId: previousSelection.get(`${row.startsAt}|${row.endsAt}`) ?? "",
      }));
    });
  }

  async function handlePublishAuto() {
    setLoading(true);
    setError(null);
    setWarning(null);

    const res = await fetch("/api/schedules/batches", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `publish-auto-${policyId}-${rangeStart}-${rangeEnd}`,
      },
      body: JSON.stringify({
        policyId,
        mode: "AUTO",
        rangeStart: new Date(`${rangeStart}T00:00:00`).toISOString(),
        rangeEnd: new Date(`${rangeEnd}T23:59:59`).toISOString(),
      }),
    });
    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError((json as { error?: string }).error ?? "Failed to publish schedule.");
    } else {
      const payload = json as {
        data?: { autoWarning?: { message?: string } };
        autoWarning?: { message?: string };
      };
      const autoWarningMessage =
        payload.data?.autoWarning?.message ?? payload.autoWarning?.message;
      if (autoWarningMessage) {
        setWarning(autoWarningMessage);
      } else {
        setOpen(false);
      }
      router.refresh();
    }
    setLoading(false);
  }

  async function handlePublishManual() {
    if (!canSubmitManual) {
      setError("Vui lòng chọn người cho tất cả các ca.");
      return;
    }

    let assignments: Array<{ assigneeId: string; startsAt: string; endsAt: string }>;
    try {
      assignments = manualRows.map((row) => {
        const startsAt = new Date(row.startsAt);
        const endsAt = new Date(row.endsAt);

        if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
          throw new Error("INVALID_MANUAL_WINDOW");
        }

        return {
          assigneeId: row.assigneeId,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
        };
      });
    } catch {
      setError("Danh sách ca manual không hợp lệ. Hãy sinh lại từ policy.");
      return;
    }

    setLoading(true);
    setError(null);
    setWarning(null);

    const sortedByStart = [...assignments].sort(
      (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
    );
    const rangeStartIso = sortedByStart[0].startsAt;
    const rangeEndIso = [...assignments].sort(
      (a, b) => new Date(b.endsAt).getTime() - new Date(a.endsAt).getTime()
    )[0].endsAt;

    const res = await fetch("/api/schedules/batches", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `publish-manual-${policyId}-${Date.now()}`,
      },
      body: JSON.stringify({
        policyId,
        mode: "MANUAL",
        rangeStart: rangeStartIso,
        rangeEnd: rangeEndIso,
        manualAssignments: assignments,
      }),
    });

    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Không thể publish lịch manual.");
    } else {
      setOpen(false);
      router.refresh();
    }
    setLoading(false);
  }

  function updateManualRow(rowId: string, patch: Partial<ManualRow>) {
    setManualRows((prev) => prev.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  }

  async function switchMode(nextMode: "AUTO" | "MANUAL") {
    setMode(nextMode);
    setError(null);
    setWarning(null);

    if (nextMode === "MANUAL") {
      await loadPolicyContext();
      if (manualRows.length === 0) {
        await generateManualRowsFromPolicy();
      }
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs px-2 py-1 bg-green-50 hover:bg-green-100 text-green-700 rounded-lg font-medium"
      >
        Publish lịch
      </button>
    );
  }

  return (
    <div className="w-full space-y-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => switchMode("AUTO")}
          className={`text-xs px-2 py-1 rounded ${mode === "AUTO" ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-700"}`}
        >
          Auto
        </button>
        <button
          type="button"
          onClick={() => switchMode("MANUAL")}
          className={`text-xs px-2 py-1 rounded ${mode === "MANUAL" ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-700"}`}
        >
          Manual assign
        </button>
      </div>

      {mode === "AUTO" ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-gray-600 whitespace-nowrap">Từ ngày</label>
            <input
              type="date"
              value={rangeStart}
              onChange={(e) => setRangeStart(e.target.value)}
              className="text-xs border border-gray-200 rounded px-2 py-1"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-gray-600 whitespace-nowrap">Đến ngày</label>
            <input
              type="date"
              value={rangeEnd}
              onChange={(e) => setRangeEnd(e.target.value)}
              className="text-xs border border-gray-200 rounded px-2 py-1"
            />
          </div>
          <button
            onClick={handlePublishAuto}
            disabled={loading}
            className="text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
          >
            {loading ? "..." : "Xác nhận"}
          </button>
          <button
            onClick={() => setOpen(false)}
            className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
          >
            Hủy
          </button>
        </div>
      ) : (
        <div className="space-y-2 border border-gray-200 rounded-lg p-3">
          {loadingPolicyContext ? (
            <p className="text-xs text-gray-500">Đang tải thành viên trong policy...</p>
          ) : manualMembers.length === 0 ? (
            <p className="text-xs text-red-600">Policy chưa có thành viên hợp lệ.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex items-center gap-1.5">
                  <label className="text-xs text-gray-600 whitespace-nowrap">Từ ngày</label>
                  <input
                    type="date"
                    value={rangeStart}
                    onChange={(e) => setRangeStart(e.target.value)}
                    className="text-xs border border-gray-200 rounded px-2 py-1"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <label className="text-xs text-gray-600 whitespace-nowrap">Đến ngày</label>
                  <input
                    type="date"
                    value={rangeEnd}
                    onChange={(e) => setRangeEnd(e.target.value)}
                    className="text-xs border border-gray-200 rounded px-2 py-1"
                  />
                </div>
                <button
                  type="button"
                  onClick={generateManualRowsFromPolicy}
                  className="text-xs px-2 py-1 bg-indigo-50 text-indigo-700 rounded hover:bg-indigo-100"
                >
                  Sinh ca theo policy
                </button>
              </div>

              {manualRows.length > 0 && (
                <p className="text-xs text-gray-500">
                  Đã sinh {manualRows.length} ca theo policy. Hãy gán người cho từng ca.
                </p>
              )}

              {manualRows.map((row, index) => (
                <div key={row.id} className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
                  <div>
                    <label className="text-[11px] text-gray-500">Người trực #{index + 1}</label>
                    <select
                      value={row.assigneeId}
                      onChange={(e) => updateManualRow(row.id, { assigneeId: e.target.value })}
                      className="input text-xs"
                    >
                      <option value="">-- Chọn người --</option>
                      {manualMembers.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.fullName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] text-gray-500">Start</label>
                    <input
                      type="datetime-local"
                      value={row.startsAt}
                      disabled
                      className="input text-xs bg-gray-50 text-gray-600"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-gray-500">End</label>
                    <input
                      type="datetime-local"
                      value={row.endsAt}
                      disabled
                      className="input text-xs bg-gray-50 text-gray-600"
                    />
                  </div>
                </div>
              ))}

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={handlePublishManual}
                  disabled={loading || !canSubmitManual}
                  className="text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                >
                  {loading ? "..." : "Xác nhận"}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
                >
                  Hủy
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {warning && <span className="text-xs text-amber-700">{warning}</span>}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
