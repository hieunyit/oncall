"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  teamId: string;
  userId: string;
  currentRole: string;
}

export function TeamMemberActions({ teamId, userId, currentRole }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function callApi(method: string, url: string, body?: object) {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error ?? "Có lỗi xảy ra");
    }
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
      await callApi("DELETE", `/api/teams/${teamId}/members?userId=${userId}`);
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
