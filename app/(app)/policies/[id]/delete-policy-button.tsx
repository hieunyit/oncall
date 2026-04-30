"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeletePolicyButton({
  policyId,
  policyName,
}: {
  policyId: string;
  policyName: string;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    setLoading(true);
    const res = await fetch(`/api/policies/${policyId}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/policies");
      router.refresh();
      return;
    }

    const data = await res.json().catch(() => ({}));
    alert(data.error ?? "Không thể xóa chính sách");
    setLoading(false);
    setConfirm(false);
  }

  if (confirm) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-gray-600">
          Xóa chính sách &quot;{policyName}&quot; và gỡ các ca trực chưa hoàn thành?
        </span>
        <button
          onClick={handleDelete}
          disabled={loading}
          className="rounded-lg bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-50"
        >
          {loading ? "Đang xử lý..." : "Xác nhận xóa"}
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
      className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
    >
      Xóa chính sách
    </button>
  );
}
