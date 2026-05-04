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

function makeRow(initialAssigneeId = ""): ManualRow {
  const start = new Date();
  const end = new Date(start.getTime() + 8 * 60 * 60 * 1000);
  return {
    id: `${Date.now()}-${Math.random()}`,
    assigneeId: initialAssigneeId,
    startsAt: toDatetimeLocal(start),
    endsAt: toDatetimeLocal(end),
  };
}

export function PublishBatchForm({ policyId, policyName: _policyName }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  async function loadPolicyContext() {
    if (policyContext || loadingPolicyContext) return;
    setLoadingPolicyContext(true);
    setError(null);

    try {
      const res = await fetch(`/api/policies/${policyId}`, { method: "GET" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Failed to load policy members.");
        return;
      }

      const policy = json.data ?? json;
      const selectedIds = Array.isArray(policy.participantUserIds) ? policy.participantUserIds as string[] : [];
      const selectedSet = new Set(selectedIds);
      const teamMembersRaw = Array.isArray(policy.team?.members) ? policy.team.members : [];
      const teamMembers = teamMembersRaw
        .map((member: { user?: { id?: string; fullName?: string; email?: string } }) => member.user)
        .filter((user: { id?: string; fullName?: string; email?: string } | undefined): user is { id: string; fullName: string; email: string } =>
          Boolean(user?.id && user.fullName && user.email)
        );
      const filteredMembers =
        selectedSet.size === 0
          ? teamMembers
          : teamMembers.filter((member: { id: string }) => selectedSet.has(member.id));

      setPolicyContext({ members: filteredMembers });
      setManualRows((prev) => {
        if (prev.length > 0) return prev;
        const firstAssignee = filteredMembers[0]?.id ?? "";
        return [makeRow(firstAssignee)];
      });
    } finally {
      setLoadingPolicyContext(false);
    }
  }

  async function handlePublishAuto() {
    setLoading(true);
    setError(null);

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

    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Failed to publish schedule.");
    } else {
      setOpen(false);
      router.refresh();
    }
    setLoading(false);
  }

  async function handlePublishManual() {
    if (!canSubmitManual) {
      setError("Please complete all manual shift rows.");
      return;
    }

    setLoading(true);
    setError(null);

    const assignments = manualRows.map((row) => ({
      assigneeId: row.assigneeId,
      startsAt: new Date(row.startsAt).toISOString(),
      endsAt: new Date(row.endsAt).toISOString(),
    }));

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
      setError(d.error ?? "Failed to publish manual schedule.");
    } else {
      setOpen(false);
      router.refresh();
    }
    setLoading(false);
  }

  function addManualRow() {
    const firstAssignee = manualMembers[0]?.id ?? "";
    setManualRows((prev) => [...prev, makeRow(firstAssignee)]);
  }

  function removeManualRow(rowId: string) {
    setManualRows((prev) => prev.filter((row) => row.id !== rowId));
  }

  function updateManualRow(rowId: string, patch: Partial<ManualRow>) {
    setManualRows((prev) => prev.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  }

  async function switchMode(nextMode: "AUTO" | "MANUAL") {
    setMode(nextMode);
    setError(null);
    if (nextMode === "MANUAL") {
      await loadPolicyContext();
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
            Huỷ
          </button>
        </div>
      ) : (
        <div className="space-y-2 border border-gray-200 rounded-lg p-3">
          {loadingPolicyContext ? (
            <p className="text-xs text-gray-500">Loading policy members...</p>
          ) : manualMembers.length === 0 ? (
            <p className="text-xs text-red-600">Policy has no eligible members.</p>
          ) : (
            <>
              {manualRows.map((row, index) => (
                <div key={row.id} className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
                  <div>
                    <label className="text-[11px] text-gray-500">Member #{index + 1}</label>
                    <select
                      value={row.assigneeId}
                      onChange={(e) => updateManualRow(row.id, { assigneeId: e.target.value })}
                      className="input text-xs"
                    >
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
                      onChange={(e) => updateManualRow(row.id, { startsAt: e.target.value })}
                      className="input text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-gray-500">End</label>
                    <input
                      type="datetime-local"
                      value={row.endsAt}
                      onChange={(e) => updateManualRow(row.id, { endsAt: e.target.value })}
                      className="input text-xs"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeManualRow(row.id)}
                    className="text-xs px-2 py-1 bg-red-50 text-red-600 rounded hover:bg-red-100"
                  >
                    Remove
                  </button>
                </div>
              ))}

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={addManualRow}
                  className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                >
                  + Add shift row
                </button>
                <button
                  type="button"
                  onClick={handlePublishManual}
                  disabled={loading || !canSubmitManual}
                  className="text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                >
                  {loading ? "..." : "Publish manual"}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
