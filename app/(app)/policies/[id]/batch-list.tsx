"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface BatchItem {
  id: string;
  rangeStart: Date;
  rangeEnd: Date;
  status: string;
  _count: { shifts: number };
}

interface Props {
  batches: BatchItem[];
}

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  PUBLISHED: { label: "Đã publish", cls: "bg-green-100 text-green-700" },
  ROLLED_BACK: { label: "Đã rollback", cls: "bg-gray-100 text-gray-500" },
  PARTIAL: { label: "Một phần", cls: "bg-orange-100 text-orange-700" },
};

export function BatchList({ batches }: Props) {
  const router = useRouter();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");

  async function handleRollback(batchId: string) {
    setLoadingId(batchId);
    setErrorId(null);
    setErrorMsg("");

    const res = await fetch(`/api/schedules/batches/${batchId}/rollback`, {
      method: "POST",
    });

    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setErrorId(batchId);
      setErrorMsg(d.error ?? "Rollback thất bại");
    } else {
      router.refresh();
    }
    setLoadingId(null);
  }

  if (batches.length === 0) {
    return (
      <p className="px-5 py-8 text-center text-gray-400 text-sm">Chưa có lô lịch nào.</p>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead className="bg-gray-50">
        <tr>
          <th className="text-left px-4 py-2 font-medium text-gray-500">Từ ngày</th>
          <th className="text-left px-4 py-2 font-medium text-gray-500">Đến ngày</th>
          <th className="text-left px-4 py-2 font-medium text-gray-500">Trạng thái</th>
          <th className="text-left px-4 py-2 font-medium text-gray-500">Số ca</th>
          <th className="text-right px-4 py-2 font-medium text-gray-500">Hành động</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {batches.map((batch) => {
          const st = STATUS_LABELS[batch.status] ?? { label: batch.status, cls: "bg-gray-100 text-gray-500" };
          return (
            <tr key={batch.id}>
              <td className="px-4 py-2 text-gray-700">
                {new Date(batch.rangeStart).toLocaleDateString("vi-VN")}
              </td>
              <td className="px-4 py-2 text-gray-700">
                {new Date(batch.rangeEnd).toLocaleDateString("vi-VN")}
              </td>
              <td className="px-4 py-2">
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${st.cls}`}>
                  {st.label}
                </span>
              </td>
              <td className="px-4 py-2 text-gray-700">{batch._count.shifts}</td>
              <td className="px-4 py-2 text-right">
                {batch.status === "PUBLISHED" && (
                  <div className="inline-flex flex-col items-end gap-1">
                    <button
                      onClick={() => handleRollback(batch.id)}
                      disabled={loadingId === batch.id}
                      className="text-xs px-2 py-1 bg-red-50 hover:bg-red-100 text-red-600 rounded font-medium disabled:opacity-50"
                    >
                      {loadingId === batch.id ? "..." : "Rollback"}
                    </button>
                    {errorId === batch.id && (
                      <span className="text-xs text-red-600">{errorMsg}</span>
                    )}
                  </div>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
