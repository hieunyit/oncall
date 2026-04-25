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
  canApprove?: boolean;
  statusLabels: Record<string, { label: string; color: string }>;
}

export function SwapCard({ swap, currentUserId, canApprove = false, statusLabels }: SwapCardProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const badge = statusLabels[swap.status] ?? { label: swap.status, color: "bg-gray-100 text-gray-600" };
  const isTarget = swap.targetUser.id === currentUserId;
  const canRespond = isTarget && swap.status === "REQUESTED";

  async function callApi(url: string, body?: object) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": `${url}-${Date.now()}` },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error ?? "Có lỗi xảy ra");
    }
  }

  async function handle(action: string, fn: () => Promise<void>) {
    setLoading(action);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Có lỗi xảy ra");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <p className="font-medium text-gray-900 text-sm">{swap.originalShift.policy.name}</p>
          <p className="text-xs text-gray-500">
            Ca gốc: {format(swap.originalShift.startsAt, "EEE dd/MM HH:mm", { locale: vi })}
            {" → "}
            {format(swap.originalShift.endsAt, "HH:mm dd/MM", { locale: vi })}
          </p>
          {swap.targetShift && (
            <p className="text-xs text-gray-500">
              Ca đổi: {format(swap.targetShift.startsAt, "EEE dd/MM HH:mm", { locale: vi })}
              {" → "}
              {format(swap.targetShift.endsAt, "HH:mm dd/MM", { locale: vi })}
            </p>
          )}
          <p className="text-xs text-gray-400">
            {swap.requester.fullName} → {swap.targetUser.fullName}
          </p>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap shrink-0 ${badge.color}`}>
          {badge.label}
        </span>
      </div>

      {swap.requesterNote && (
        <p className="text-xs text-gray-500 bg-gray-50 rounded px-3 py-2">
          Ghi chú: {swap.requesterNote}
        </p>
      )}

      {error && (
        <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
      )}

      {/* Target user: accept/decline */}
      {canRespond && (
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => handle("accept", () => callApi(`/api/swaps/${swap.id}/respond`, { action: "accept" }))}
            disabled={!!loading}
            className="text-sm px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            {loading === "accept" ? "..." : "Chấp nhận"}
          </button>
          <button
            onClick={() => handle("decline", () => callApi(`/api/swaps/${swap.id}/respond`, { action: "decline" }))}
            disabled={!!loading}
            className="text-sm px-3 py-1.5 bg-white border border-red-200 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50"
          >
            {loading === "decline" ? "..." : "Từ chối"}
          </button>
        </div>
      )}

      {/* Manager: approve/reject after target accepted */}
      {canApprove && swap.status === "ACCEPTED_BY_TARGET" && (
        <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
          <span className="text-xs text-gray-400 mr-1">Phê duyệt:</span>
          <button
            onClick={() => handle("approve", () => callApi(`/api/swaps/${swap.id}/approve`, {}))}
            disabled={!!loading}
            className="text-sm px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading === "approve" ? "..." : "Duyệt"}
          </button>
          <button
            onClick={() => handle("reject", () => callApi(`/api/swaps/${swap.id}/reject`, {}))}
            disabled={!!loading}
            className="text-sm px-3 py-1.5 bg-white border border-red-200 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50"
          >
            {loading === "reject" ? "..." : "Từ chối"}
          </button>
        </div>
      )}
    </div>
  );
}
