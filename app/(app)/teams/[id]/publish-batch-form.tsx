"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  policyId: string;
  policyName: string;
}

export function PublishBatchForm({ policyId, policyName }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [weeks, setWeeks] = useState(4);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePublish() {
    setLoading(true);
    setError(null);
    const rangeStart = new Date();
    rangeStart.setHours(0, 0, 0, 0);

    const res = await fetch("/api/schedules/batches", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `publish-${policyId}-${rangeStart.toISOString()}-${weeks}w`,
      },
      body: JSON.stringify({
        policyId,
        rangeStart: rangeStart.toISOString(),
        weeks,
      }),
    });

    if (!res.ok) {
      const d = await res.json();
      setError(d.error ?? "Lỗi khi publish");
    } else {
      setOpen(false);
      router.refresh();
    }
    setLoading(false);
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
    <div className="flex items-center gap-2">
      <select
        value={weeks}
        onChange={(e) => setWeeks(Number(e.target.value))}
        className="text-xs border border-gray-200 rounded px-2 py-1"
      >
        {[1, 2, 4, 8, 12].map((w) => (
          <option key={w} value={w}>{w} tuần</option>
        ))}
      </select>
      <button
        onClick={handlePublish}
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
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
