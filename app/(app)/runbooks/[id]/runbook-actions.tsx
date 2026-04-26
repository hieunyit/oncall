"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RunbookForm } from "../runbook-form";

interface RunbookActionsProps {
  runbookId: string;
  initialTitle: string;
  initialContent: string;
  initialKeywords: string[];
  initialTeamId: string;
  teams: { id: string; name: string }[];
}

export function RunbookActions({
  runbookId,
  initialTitle,
  initialContent,
  initialKeywords,
  initialTeamId,
  teams,
}: RunbookActionsProps) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (!confirm(`Xóa runbook "${initialTitle}"? Hành động này không thể hoàn tác.`)) return;
    setDeleting(true);
    const res = await fetch(`/api/runbooks/${runbookId}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/runbooks");
      router.refresh();
    } else {
      setError("Không thể xóa runbook");
      setDeleting(false);
    }
  }

  if (mode === "edit") {
    return (
      <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-6 overflow-y-auto">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl my-4">
          <div className="px-6 py-5 border-b flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Chỉnh sửa runbook</h2>
            <button onClick={() => setMode("view")} className="text-gray-400 hover:text-gray-600">✕</button>
          </div>
          <div className="px-6 py-5">
            <RunbookForm
              teams={teams}
              initial={{
                id: runbookId,
                teamId: initialTeamId,
                title: initialTitle,
                content: initialContent,
                keywords: initialKeywords,
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 shrink-0">
      {error && <span className="text-xs text-red-600">{error}</span>}
      <button
        onClick={() => setMode("edit")}
        className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50"
      >
        Chỉnh sửa
      </button>
      <button
        onClick={handleDelete}
        disabled={deleting}
        className="px-3 py-1.5 text-sm border border-red-200 rounded-lg text-red-600 hover:bg-red-50 disabled:opacity-50"
      >
        {deleting ? "..." : "Xóa"}
      </button>
    </div>
  );
}
