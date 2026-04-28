"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RescheduleButton({ policyId }: { policyId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [result, setResult] = useState<{ removedShifts: number; newShifts: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setState("loading");
    setError(null);
    try {
      const res = await fetch(`/api/policies/${policyId}/reschedule-from-now`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Không thể tạo lại lịch.");
        setState("err");
      } else {
        const d = json.data ?? json;
        setResult({ removedShifts: d.removedShifts, newShifts: d.newShifts });
        setState("ok");
        router.refresh();
      }
    } catch {
      setError("Không thể kết nối đến máy chủ.");
      setState("err");
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={state === "loading"}
        className="px-4 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50 transition-colors"
      >
        {state === "loading" ? "Đang tạo lại..." : "Tạo lại lịch từ hôm nay"}
      </button>
      {state === "ok" && result && (
        <p className="text-xs text-green-700">
          ✓ Đã xóa {result.removedShifts} ca cũ, tạo {result.newShifts} ca mới theo danh sách hiện tại.
        </p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
