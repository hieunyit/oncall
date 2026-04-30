"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  teamId: string;
  userId: string;
  currentRole: string;
}

type DeleteMemberResponse = {
  data?: {
    removed?: boolean;
    rescheduleSummary?: {
      totalPolicies: number;
      ok: number;
      skipped: number;
      failed: number;
      queueDegraded: number;
      failedPolicies: Array<{ policyId: string; error: string }>;
    };
  };
};

export function TeamMemberActions({ teamId, userId, currentRole }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function callApi<T>(method: string, url: string, body?: object): Promise<T | undefined> {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) {
      throw new Error(payload.error ?? "Có lỗi xảy ra");
    }
    return payload;
  }

  async function toggleRole() {
    setLoading(true);
    setError(null);
    const newRole = currentRole === "MANAGER" ? "MEMBER" : "MANAGER";
    try {
      await callApi("PATCH", `/api/teams/${teamId}/members`, { userId, role: newRole });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi");
    } finally {
      setLoading(false);
    }
  }

  async function removeMember() {
    if (!confirm("Xóa thành viên này khỏi nhóm?")) return;
    setLoading(true);
    setError(null);
    try {
      const payload = await callApi<DeleteMemberResponse>(
        "DELETE",
        `/api/teams/${teamId}/members?userId=${userId}`
      );
      const summary = payload?.data?.rescheduleSummary;
      if (summary?.failed && summary.failed > 0) {
        const first = summary.failedPolicies?.[0]?.error;
        setError(
          `Đã xóa thành viên nhưng có ${summary.failed}/${summary.totalPolicies} chính sách chưa cập nhật lịch${first ? `: ${first}` : "."}`
        );
      } else if (summary?.queueDegraded && summary.queueDegraded > 0) {
        setError(
          `Đã xóa thành viên và cập nhật lịch, nhưng ${summary.queueDegraded}/${summary.totalPolicies} chính sách chưa lên lịch nhắc ca qua queue.`
        );
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        <button
          onClick={toggleRole}
          disabled={loading}
          className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-600 disabled:opacity-50"
        >
          {currentRole === "MANAGER" ? "→ Member" : "→ Manager"}
        </button>
        <button
          onClick={removeMember}
          disabled={loading}
          className="text-xs px-2 py-1 rounded bg-red-50 hover:bg-red-100 text-red-600 disabled:opacity-50"
        >
          Xóa
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
