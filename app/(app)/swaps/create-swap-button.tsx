"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ShiftOption {
  id: string;
  label: string;
}

export function CreateSwapButton({ myShifts }: { myShifts: ShiftOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [originalShiftId, setOriginalShiftId] = useState("");
  const [targetEmail, setTargetEmail] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Lookup target user by email
    const userRes = await fetch(
      `/api/users?search=${encodeURIComponent(targetEmail)}&limit=1`
    );
    const userData = await userRes.json();
    const targetUser = userData.data?.users?.[0];
    if (!targetUser) {
      setError("Không tìm thấy người dùng với email này");
      setLoading(false);
      return;
    }

    const key = `swap-${originalShiftId}-${targetUser.id}-${Date.now()}`;
    const res = await fetch("/api/swaps", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": key,
      },
      body: JSON.stringify({
        originalShiftId,
        targetUserId: targetUser.id,
        requesterNote: note || undefined,
      }),
    });

    if (!res.ok) {
      const d = await res.json();
      setError(d.error ?? "Lỗi khi tạo yêu cầu");
      setLoading(false);
      return;
    }

    setOpen(false);
    setOriginalShiftId("");
    setTargetEmail("");
    setNote("");
    router.refresh();
    setLoading(false);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
      >
        + Yêu cầu đổi ca
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="px-6 py-5 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Yêu cầu đổi ca</h2>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Ca trực của bạn cần đổi
            </label>
            <select
              required
              value={originalShiftId}
              onChange={(e) => setOriginalShiftId(e.target.value)}
              className="input"
            >
              <option value="">Chọn ca trực...</option>
              {myShifts.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Email người bạn muốn đổi ca
            </label>
            <input
              required
              type="email"
              value={targetEmail}
              onChange={(e) => setTargetEmail(e.target.value)}
              placeholder="nguoi.dong.nghiep@company.com"
              className="input"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Ghi chú (tuỳ chọn)
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Lý do đổi ca..."
              className="input resize-none"
            />
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "Đang gửi..." : "Gửi yêu cầu"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-4 py-2.5 text-gray-600 hover:text-gray-900"
            >
              Huỷ
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
