"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  userId: string;
  currentRole: string;
  isActive: boolean;
}

export function UserRoleActions({ userId, currentRole, isActive }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = async (data: Record<string, unknown>) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
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

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2 justify-end">
        {currentRole === "ADMIN" ? (
          <button
            disabled={loading}
            onClick={() => patch({ systemRole: "USER" })}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 whitespace-nowrap"
          >
            Hạ xuống User
          </button>
        ) : (
          <button
            disabled={loading}
            onClick={() => patch({ systemRole: "ADMIN" })}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-purple-200 text-purple-700 hover:bg-purple-50 disabled:opacity-40 whitespace-nowrap"
          >
            Nâng lên Admin
          </button>
        )}
        {isActive ? (
          <button
            disabled={loading}
            onClick={() => patch({ isActive: false })}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40 whitespace-nowrap"
          >
            Vô hiệu hoá
          </button>
        ) : (
          <button
            disabled={loading}
            onClick={() => patch({ isActive: true })}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-green-200 text-green-700 hover:bg-green-50 disabled:opacity-40 whitespace-nowrap"
          >
            Kích hoạt
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-600 mt-0.5">{error}</p>}
    </div>
  );
}
