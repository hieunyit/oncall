"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ShiftOption {
  id: string;
  label: string;
}

type SwapMode = "open" | "targeted";

export function CreateSwapButton({ myShifts }: { myShifts: ShiftOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<SwapMode>("open");
  const [originalShiftId, setOriginalShiftId] = useState("");
  const [targetEmail, setTargetEmail] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setOriginalShiftId("");
    setTargetEmail("");
    setNote("");
    setError(null);
    setMode("open");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    let targetUserId: string | null = null;

    if (mode === "targeted") {
      const userRes = await fetch(`/api/users?search=${encodeURIComponent(targetEmail)}&limit=1`);
      const userData = await userRes.json();
      const targetUser = userData.data?.users?.[0];
      if (!targetUser) {
        setError("Không tìm thấy người dùng với email này");
        setLoading(false);
        return;
      }
      targetUserId = targetUser.id;
    }

    const key = `swap-${originalShiftId}-${targetUserId ?? "open"}-${Date.now()}`;
    const res = await fetch("/api/swaps", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({
        originalShiftId,
        targetUserId,
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
    reset();
    router.refresh();
    setLoading(false);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 flex items-center gap-2"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/>
        </svg>
        Yêu cầu đổi ca
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Yêu cầu đổi ca</h2>
          <button onClick={() => { setOpen(false); reset(); }} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
          )}

          {/* Mode toggle */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Loại yêu cầu</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode("open")}
                className={`px-3 py-2.5 rounded-lg border text-sm font-medium text-left transition-all ${
                  mode === "open"
                    ? "bg-indigo-50 border-indigo-400 text-indigo-700"
                    : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-base">🔓</span>
                  <span>Mở cho mọi người</span>
                </div>
                <p className="text-xs opacity-70 font-normal pl-6">Ai trong nhóm cũng có thể nhận</p>
              </button>
              <button
                type="button"
                onClick={() => setMode("targeted")}
                className={`px-3 py-2.5 rounded-lg border text-sm font-medium text-left transition-all ${
                  mode === "targeted"
                    ? "bg-indigo-50 border-indigo-400 text-indigo-700"
                    : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-base">👤</span>
                  <span>Chỉ định người</span>
                </div>
                <p className="text-xs opacity-70 font-normal pl-6">Gửi yêu cầu đến 1 người cụ thể</p>
              </button>
            </div>
          </div>

          {/* My shift to swap */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Ca trực của bạn cần đổi</label>
            {myShifts.length === 0 ? (
              <p className="text-sm text-gray-400 py-2">Bạn không có ca trực sắp tới.</p>
            ) : (
              <select
                required
                value={originalShiftId}
                onChange={(e) => setOriginalShiftId(e.target.value)}
                className="input w-full"
              >
                <option value="">Chọn ca trực...</option>
                {myShifts.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            )}
          </div>

          {/* Target user (only if targeted mode) */}
          {mode === "targeted" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Email người bạn muốn đổi cùng</label>
              <input
                required
                type="email"
                value={targetEmail}
                onChange={(e) => setTargetEmail(e.target.value)}
                placeholder="nguoi.dong.nghiep@company.com"
                className="input w-full"
              />
            </div>
          )}

          {/* Note */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Lý do <span className="text-gray-400 font-normal">(tuỳ chọn)</span>
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Ví dụ: Tôi có việc gia đình ngày hôm đó..."
              className="input w-full resize-none"
            />
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={loading || myShifts.length === 0}
              className="flex-1 py-2.5 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm"
            >
              {loading ? "Đang gửi..." : mode === "open" ? "Đăng yêu cầu mở" : "Gửi yêu cầu"}
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); reset(); }}
              className="px-4 py-2.5 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg"
            >
              Huỷ
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
