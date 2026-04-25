"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";

interface ShiftUser {
  id: string;
  fullName: string;
}

interface Props {
  shift: {
    id: string;
    policyName: string;
    assigneeName: string;
    startsAt: Date;
    endsAt: Date;
  };
  teamMembers: ShiftUser[];
  onClose: () => void;
}

export function OverrideShiftModal({ shift, teamMembers, onClose }: Props) {
  const router = useRouter();
  const [assigneeId, setAssigneeId] = useState(teamMembers[0]?.id ?? "");
  const [startsAt, setStartsAt] = useState(
    format(shift.startsAt, "yyyy-MM-dd'T'HH:mm")
  );
  const [endsAt, setEndsAt] = useState(
    format(shift.endsAt, "yyyy-MM-dd'T'HH:mm")
  );
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    const res = await fetch(`/api/shifts/${shift.id}/override`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assigneeId,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
        notes: notes || undefined,
      }),
    });
    setSaving(false);
    if (res.ok) {
      onClose();
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Không thể tạo override.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl border border-gray-200 shadow-xl w-full max-w-md">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Override ca trực</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-100 text-xs text-amber-800">
            <p className="font-medium">{shift.policyName}</p>
            <p className="text-amber-600">Người trực hiện tại: {shift.assigneeName}</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Thay bằng người
            </label>
            <select
              className="input w-full"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              required
            >
              {teamMembers.map((m) => (
                <option key={m.id} value={m.id}>{m.fullName}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Bắt đầu</label>
              <input
                type="datetime-local"
                className="input w-full text-sm"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Kết thúc</label>
              <input
                type="datetime-local"
                className="input w-full text-sm"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Ghi chú (tuỳ chọn)
            </label>
            <input
              className="input w-full"
              placeholder="Lý do override..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

          <div className="flex gap-3 justify-end pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50"
            >
              {saving ? "Đang tạo..." : "Tạo Override"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
