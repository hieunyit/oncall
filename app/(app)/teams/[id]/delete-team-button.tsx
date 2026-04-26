"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface CascadeInfo {
  memberCount: number;
  policyCount: number;
}

export function DeleteTeamButton({ teamId, teamName }: { teamId: string; teamName: string }) {
  const router = useRouter();
  const [step, setStep] = useState<"idle" | "loading-info" | "confirm" | "deleting">("idle");
  const [info, setInfo] = useState<CascadeInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClickDelete() {
    setStep("loading-info");
    setError(null);
    try {
      const res = await fetch(`/api/teams/${teamId}`);
      if (res.ok) {
        const d = await res.json();
        const team = d.data;
        setInfo({
          memberCount: team.members?.length ?? 0,
          policyCount: team.rotationPolicies?.length ?? 0,
        });
      }
    } catch {}
    setStep("confirm");
  }

  async function handleConfirm() {
    setStep("deleting");
    setError(null);
    const res = await fetch(`/api/teams/${teamId}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/teams");
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Không thể xóa nhóm");
      setStep("confirm");
    }
  }

  if (step === "idle") {
    return (
      <button
        onClick={handleClickDelete}
        className="px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
      >
        Xóa nhóm
      </button>
    );
  }

  if (step === "loading-info") {
    return (
      <span className="text-sm text-gray-400">Đang kiểm tra...</span>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-3 bg-red-50 border border-red-200 rounded-lg max-w-sm">
      <p className="text-sm font-medium text-red-800">Xóa nhóm &quot;{teamName}&quot;?</p>
      <p className="text-xs text-red-700">
        Hành động này <strong>không thể hoàn tác</strong> và sẽ xóa toàn bộ:
      </p>
      {info && (
        <ul className="text-xs text-red-700 space-y-0.5 pl-3">
          {info.memberCount > 0 && <li>• {info.memberCount} thành viên</li>}
          {info.policyCount > 0 && <li>• {info.policyCount} chính sách xoay vòng và toàn bộ ca trực</li>}
          <li>• Tất cả yêu cầu đổi ca, xác nhận, thông báo liên quan</li>
        </ul>
      )}
      {error && <p className="text-xs text-red-600 font-medium">{error}</p>}
      <div className="flex items-center gap-2 mt-1">
        <button
          onClick={handleConfirm}
          disabled={step === "deleting"}
          className="px-3 py-1.5 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
        >
          {step === "deleting" ? "Đang xóa..." : "Xác nhận xóa vĩnh viễn"}
        </button>
        <button
          onClick={() => { setStep("idle"); setError(null); }}
          className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-900"
        >
          Hủy
        </button>
      </div>
    </div>
  );
}
