"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  policyId: string;
  policyName: string;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function PublishBatchForm({ policyId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = new Date();
  const fourWeeksLater = new Date(today);
  fourWeeksLater.setDate(fourWeeksLater.getDate() + 28);

  const [rangeStart, setRangeStart] = useState(toDateStr(today));
  const [rangeEnd, setRangeEnd] = useState(toDateStr(fourWeeksLater));

  async function handlePublish() {
    setLoading(true);
    setError(null);

    const res = await fetch("/api/schedules/batches", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `publish-${policyId}-${rangeStart}-${rangeEnd}`,
      },
      body: JSON.stringify({
        policyId,
        rangeStart: new Date(rangeStart + "T00:00:00").toISOString(),
        rangeEnd: new Date(rangeEnd + "T23:59:59").toISOString(),
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
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1.5">
        <label className="text-xs text-gray-600 whitespace-nowrap">Từ ngày</label>
        <input
          type="date"
          value={rangeStart}
          onChange={(e) => setRangeStart(e.target.value)}
          className="text-xs border border-gray-200 rounded px-2 py-1"
        />
      </div>
      <div className="flex items-center gap-1.5">
        <label className="text-xs text-gray-600 whitespace-nowrap">Đến ngày</label>
        <input
          type="date"
          value={rangeEnd}
          onChange={(e) => setRangeEnd(e.target.value)}
          className="text-xs border border-gray-200 rounded px-2 py-1"
        />
      </div>
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
