"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ConfirmActionButtons({
  token,
  requireCheckInPhoto,
}: {
  token: string;
  requireCheckInPhoto: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<"confirm" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proofImage, setProofImage] = useState<File | null>(null);

  async function handleAction(action: "confirm" | "decline") {
    setLoading(action);
    setError(null);
    try {
      const res =
        action === "confirm"
          ? await (async () => {
              const form = new FormData();
              form.set("action", action);
              if (proofImage) form.set("proofImage", proofImage);
              return fetch(`/api/confirmations/${token}`, {
                method: "POST",
                body: form,
              });
            })()
          : await fetch(`/api/confirmations/${token}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action }),
            });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? "Có lỗi xảy ra");
        return;
      }

      setProofImage(null);
      router.refresh();
    } catch {
      setError("Không thể kết nối đến máy chủ");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-red-600 text-center">{error}</p>}

      <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
        <label className="block text-xs font-medium text-gray-700 mb-1">
          {requireCheckInPhoto
            ? "Ảnh check-in (bắt buộc theo policy)"
            : "Ảnh check-in (tùy chọn)"}
        </label>
        <input
          type="file"
          accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
          onChange={(e) => setProofImage(e.target.files?.[0] ?? null)}
          className="block w-full text-xs text-gray-700 file:mr-2 file:rounded file:border file:border-gray-300 file:bg-white file:px-2 file:py-1 file:text-xs file:text-gray-700 hover:file:bg-gray-100"
        />
        {proofImage && (
          <p className="mt-1 text-xs text-gray-600">Đã chọn: {proofImage.name}</p>
        )}
      </div>

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
