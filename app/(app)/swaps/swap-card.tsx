"use client";

import { format, formatDistanceToNow } from "date-fns";
import { vi } from "date-fns/locale";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface SwapCardProps {
  swap: {
    id: string;
    status: string;
    requesterId: string;
    requester: { id: string; fullName: string };
    targetUser: { id: string; fullName: string } | null;
    originalShift: { startsAt: Date; endsAt: Date; policy: { name: string } };
    targetShift?: { startsAt: Date; endsAt: Date; policy?: { name: string } } | null;
    requesterNote?: string | null;
    targetNote?: string | null;
    managerNote?: string | null;
    expiresAt?: Date;
  };
  currentUserId: string;
  canApprove?: boolean;
  canTake?: boolean;
  statusLabels: Record<string, { label: string; color: string }>;
}

export function SwapCard({
  swap,
  currentUserId,
  canApprove = false,
  canTake = false,
  statusLabels,
}: SwapCardProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isOpen = swap.targetUser === null && swap.status === "REQUESTED";
  const badge = statusLabels[swap.status] ?? { label: swap.status, color: "bg-gray-100 text-gray-600" };
  const isTarget = swap.targetUser?.id === currentUserId;
  const isRequester = swap.requesterId === currentUserId;
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
    <div className={`bg-white rounded-xl border p-4 space-y-3 ${
      isOpen ? "border-green-200 bg-green-50/30" : "border-gray-200"
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          {/* Who & direction */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900">
              {swap.requester.fullName}
            </span>
            {isRequester && (
              <span className="text-[10px] px-1.5 py-0.5 bg-indigo-100 text-indigo-600 rounded font-medium">Bạn</span>
            )}
            <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3"/>
            </svg>
            {isOpen ? (
              <span className="text-sm text-green-700 font-medium flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                Ai cũng được
              </span>
            ) : (
              <span className="text-sm text-gray-700 font-medium">
                {swap.targetUser?.fullName}
                {isTarget && (
                  <span className="ml-1 text-[10px] px-1.5 py-0.5 bg-indigo-100 text-indigo-600 rounded font-medium">Bạn</span>
                )}
              </span>
            )}
          </div>

          {/* Shift info */}
          <p className="text-xs text-gray-500">
            <span className="font-medium text-gray-700">{swap.originalShift.policy.name}</span>
            {" · "}
            {format(swap.originalShift.startsAt, "EEE dd/MM HH:mm", { locale: vi })}
            {" → "}
            {format(swap.originalShift.endsAt, "HH:mm dd/MM", { locale: vi })}
          </p>

          {swap.targetShift && (
            <p className="text-xs text-gray-400">
              Đổi lấy: {format(swap.targetShift.startsAt, "EEE dd/MM HH:mm", { locale: vi })}
              {" → "}
              {format(swap.targetShift.endsAt, "HH:mm dd/MM", { locale: vi })}
            </p>
          )}

          {swap.expiresAt && isOpen && (
            <p className="text-[11px] text-gray-400">
              Hết hạn {formatDistanceToNow(swap.expiresAt, { addSuffix: true, locale: vi })}
            </p>
          )}
        </div>

        <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap shrink-0 ${badge.color}`}>
          {isOpen ? "Cần người nhận" : badge.label}
        </span>
      </div>

      {swap.requesterNote && (
        <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 italic">
          &ldquo;{swap.requesterNote}&rdquo;
        </p>
      )}

      {error && (
        <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
      )}

      {/* Take button (open swaps) */}
      {canTake && isOpen && (
        <div className="pt-1">
          <button
            onClick={() => handle("take", () => callApi(`/api/swaps/${swap.id}/take`))}
            disabled={!!loading}
            className="w-full py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading === "take" ? (
              <span>Đang xử lý...</span>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
                Nhận ca này
              </>
            )}
          </button>
        </div>
      )}

      {/* Target user: accept/decline (targeted swaps) */}
      {canRespond && (
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => handle("accept", () => callApi(`/api/swaps/${swap.id}/respond`, { action: "accept" }))}
            disabled={!!loading}
            className="text-sm px-4 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            {loading === "accept" ? "..." : "Chấp nhận"}
          </button>
          <button
            onClick={() => handle("decline", () => callApi(`/api/swaps/${swap.id}/respond`, { action: "decline" }))}
            disabled={!!loading}
            className="text-sm px-4 py-1.5 bg-white border border-red-200 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50"
          >
            {loading === "decline" ? "..." : "Từ chối"}
          </button>
        </div>
      )}

      {/* Requester: cancel their own pending request */}
      {isRequester && swap.status === "REQUESTED" && !canTake && (
        <div className="pt-1 border-t border-gray-100">
          <button
            onClick={() => handle("cancel", () => callApi(`/api/swaps/${swap.id}/respond`, { action: "cancel" }))}
            disabled={!!loading}
            className="text-xs text-gray-400 hover:text-red-600 transition-colors disabled:opacity-50"
          >
            {loading === "cancel" ? "Đang hủy..." : "Hủy yêu cầu này"}
          </button>
        </div>
      )}

      {/* Manager: approve/reject */}
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
