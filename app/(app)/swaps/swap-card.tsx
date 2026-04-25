"use client";

import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface SwapCardProps {
  swap: {
    id: string;
    status: string;
    requesterId: string;
    requester: { id: string; fullName: string };
    targetUser: { id: string; fullName: string };
    originalShift: { startsAt: Date; endsAt: Date; policy: { name: string } };
    targetShift?: { startsAt: Date; endsAt: Date; policy: { name: string } } | null;
    requesterNote?: string | null;
    targetNote?: string | null;
    managerNote?: string | null;
  };
  currentUserId: string;
  statusLabels: Record<string, { label: string; color: string }>;
}

export function SwapCard({ swap, currentUserId, statusLabels }: SwapCardProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);

  const badge = statusLabels[swap.status] ?? {
    label: swap.status,
    color: "bg-gray-100 text-gray-600",
  };

  const isTarget = swap.targetUser.id === currentUserId;
  const canRespond =
    isTarget && swap.status === "REQUESTED";

  async function respond(action: "accept" | "decline") {
    setLoading(action);
    await fetch(`/api/swaps/${swap.id}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    router.refresh();
    setLoading(null);
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="font-medium text-gray-900 text-sm">
            {swap.originalShift.policy.name}
          </p>
          <p className="text-xs text-gray-500">
            Ca gốc:{" "}
            {format(swap.originalShift.startsAt, "EEE dd/MM HH:mm", { locale: vi })}
            {" → "}
            {format(swap.originalShift.endsAt, "HH:mm dd/MM", { locale: vi })}
          </p>
          {swap.targetShift && (
            <p className="text-xs text-gray-500">
              Ca đổi:{" "}
              {format(swap.targetShift.startsAt, "EEE dd/MM HH:mm", { locale: vi })}
              {" → "}
              {format(swap.targetShift.endsAt, "HH:mm dd/MM", { locale: vi })}
            </p>
          )}
          <p className="text-xs text-gray-400">
            {swap.requester.fullName} → {swap.targetUser.fullName}
          </p>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${badge.color}`}>
          {badge.label}
        </span>
      </div>

      {swap.requesterNote && (
        <p className="text-xs text-gray-500 bg-gray-50 rounded px-3 py-2">
          Ghi chú: {swap.requesterNote}
        </p>
      )}

      {canRespond && (
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => respond("accept")}
            disabled={!!loading}
            className="text-sm px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            {loading === "accept" ? "..." : "Chấp nhận"}
          </button>
          <button
            onClick={() => respond("decline")}
            disabled={!!loading}
            className="text-sm px-3 py-1.5 bg-white border border-red-200 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50"
          >
            {loading === "decline" ? "..." : "Từ chối"}
          </button>
        </div>
      )}
    </div>
  );
}
