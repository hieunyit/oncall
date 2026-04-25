"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AlertActions({ alert }: { alert: { id: string; status: string } }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const act = async (action: "acknowledge" | "resolve") => {
    setLoading(true);
    await fetch(`/api/alerts/${alert.id}/${action}`, { method: "POST" });
    setLoading(false);
    router.refresh();
  };

  if (alert.status === "RESOLVED") return null;

  return (
    <div className="flex items-center gap-2 shrink-0">
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
  );
}
