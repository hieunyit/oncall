"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeletePolicyButton({ policyId, policyName }: { policyId: string; policyName: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    setLoading(true);
    const res = await fetch(`/api/policies/${policyId}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/policies");
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      alert(d.error ?? "Không thể khóa chính sách");
      setLoading(false);
      setConfirm(false);
    }
  }

  if (confirm) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-gray-600">Khóa chính sách &quot;{policyName}&quot; và xóa lịch trực tương lai?</span>
        <button
          onClick={handleDelete}
          disabled={loading}
          className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
        >
          {loading ? "Đang xử lý..." : "Xác nhận"}
        </button>
        <button
          onClick={() => setConfirm(false)}
          className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900"
        >
          Hủy
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirm(true)}
      className="px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
    >
      Khóa chính sách
    </button>
  );
}
