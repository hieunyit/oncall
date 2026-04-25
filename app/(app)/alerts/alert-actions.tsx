"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AlertActions({ alert }: { alert: { id: string; status: string } }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (action: "acknowledge" | "resolve") => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/alerts/${alert.id}/${action}`, { method: "POST" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Có lỗi xảy ra");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi");
    } finally {
      setLoading(false);
    }
  };

  if (alert.status === "RESOLVED") return null;

  return (
    <div className="flex flex-col items-end gap-1 shrink-0">
      <div className="flex items-center gap-2">
        {alert.status === "FIRING" && (
          <button
            disabled={loading}
            onClick={() => act("acknowledge")}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-yellow-200 text-yellow-700 hover:bg-yellow-50 transition-colors disabled:opacity-40 whitespace-nowrap"
          >
            Nhận
          </button>
        )}
        <button
          disabled={loading}
          onClick={() => act("resolve")}
          className="text-xs px-2.5 py-1.5 rounded-lg border border-green-200 text-green-700 hover:bg-green-50 transition-colors disabled:opacity-40 whitespace-nowrap"
        >
          Resolve
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
