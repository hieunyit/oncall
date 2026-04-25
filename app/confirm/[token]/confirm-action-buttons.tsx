"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ConfirmActionButtons({ token }: { token: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState<"confirm" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAction(action: "confirm" | "decline") {
    setLoading(action);
    setError(null);
    try {
      const res = await fetch(`/api/confirmations/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Có lỗi xảy ra");
        return;
      }
      router.refresh();
    } catch {
      setError("Không thể kết nối đến máy chủ");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="text-sm text-red-600 text-center">{error}</p>
      )}
      <button
        onClick={() => handleAction("confirm")}
        disabled={!!loading}
        className="w-full py-3 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-medium rounded-xl transition-colors"
      >
        {loading === "confirm" ? "Đang xử lý..." : "✅ Xác nhận tham gia"}
      </button>
      <button
        onClick={() => handleAction("decline")}
        disabled={!!loading}
        className="w-full py-3 bg-white hover:bg-red-50 disabled:opacity-50 text-red-600 font-medium rounded-xl border border-red-200 transition-colors"
      >
        {loading === "decline" ? "Đang xử lý..." : "❌ Từ chối ca trực"}
      </button>
    </div>
  );
}
