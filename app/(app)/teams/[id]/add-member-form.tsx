"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface User {
  id: string;
  fullName: string;
  email: string;
}

interface Props {
  teamId: string;
  availableUsers: User[];
}

export function AddMemberForm({ teamId, availableUsers }: Props) {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<"MEMBER" | "MANAGER">("MEMBER");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    if (!userId) return;
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/teams/${teamId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role }),
    });
    if (!res.ok) {
      const d = await res.json();
      setError(d.error ?? "Lỗi khi thêm thành viên");
    } else {
      setUserId("");
      router.refresh();
    }
    setLoading(false);
  }

  if (availableUsers.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <select
        value={userId}
        onChange={(e) => setUserId(e.target.value)}
        className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 flex-1 bg-white text-gray-900"
      >
        <option value="">Chọn người dùng...</option>
        {availableUsers.map((u) => (
          <option key={u.id} value={u.id}>
            {u.fullName} ({u.email})
          </option>
        ))}
      </select>
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as "MEMBER" | "MANAGER")}
        className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-900"
      >
        <option value="MEMBER">Thành viên</option>
        <option value="MANAGER">Quản lý</option>
      </select>
      <button
        onClick={handleAdd}
        disabled={!userId || loading}
        className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "..." : "+ Thêm"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
