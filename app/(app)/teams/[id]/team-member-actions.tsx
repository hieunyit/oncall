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

  async function toggleRole() {
    setLoading(true);
    const newRole = currentRole === "MANAGER" ? "MEMBER" : "MANAGER";
    await fetch(`/api/teams/${teamId}/members`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role: newRole }),
    });
    router.refresh();
    setLoading(false);
  }

  async function removeMember() {
    if (!confirm("Xóa thành viên này khỏi nhóm?")) return;
    setLoading(true);
    await fetch(`/api/teams/${teamId}/members?userId=${userId}`, {
      method: "DELETE",
    });
    router.refresh();
    setLoading(false);
  }

  return (
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
  );
}
