"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { EscalationPolicy, EscalationRule, Team, RotationPolicy } from "@/app/generated/prisma/client";

type PolicyWithRelations = EscalationPolicy & {
  team: Pick<Team, "id" | "name">;
  rules: EscalationRule[];
  rotationPolicies: Pick<RotationPolicy, "id" | "name">[];
};

const TARGET_LABELS: Record<string, string> = {
  PRIMARY: "Primary on-call",
  BACKUP: "Backup on-call",
  MANAGER: "Manager nhóm",
  TEAM_CHANNEL: "Kênh nhóm",
};

const CHANNEL_LABELS: Record<string, string> = {
  EMAIL: "Email",
  TELEGRAM: "Telegram",
  TEAMS: "Teams",
};

export function EscalationPolicyCard({
  policy,
  isAdmin,
}: {
  policy: PolicyWithRelations;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`Xóa escalation chain "${policy.name}"?`)) return;
    setDeleting(true);
    await fetch(`/api/escalation-policies/${policy.id}`, { method: "DELETE" });
    setDeleting(false);
    router.refresh();
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-5 py-4 flex items-center justify-between border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full shrink-0 ${policy.isActive ? "bg-green-500" : "bg-gray-300"}`} />
          <div>
            <p className="font-medium text-gray-900">{policy.name}</p>
            <p className="text-xs text-gray-400">{policy.team.name}</p>
          </div>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <Link
              href={`/escalation/${policy.id}/edit`}
              className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Chỉnh sửa
            </Link>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="text-xs px-2.5 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40"
            >
              Xóa
            </button>
          </div>
        )}
      </div>

      {/* Rules timeline */}
      <div className="px-5 py-4">
        {policy.rules.length === 0 ? (
          <p className="text-sm text-gray-400 italic">Chưa có bước nào.</p>
        ) : (
          <div className="space-y-0">
            {policy.rules.map((rule, idx) => (
              <div key={rule.id} className="flex items-start gap-3">
                <div className="flex flex-col items-center">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                    rule.isActive ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-400"
                  }`}>
                    {rule.stepOrder}
                  </div>
                  {idx < policy.rules.length - 1 && (
                    <div className="w-px h-6 bg-gray-200 mt-1" />
                  )}
                </div>
                <div className="pb-3">
                  <p className="text-sm text-gray-800 font-medium">
                    {TARGET_LABELS[rule.target] ?? rule.target}
                    <span className="text-gray-400 font-normal"> via {CHANNEL_LABELS[rule.channelType] ?? rule.channelType}</span>
                  </p>
                  <p className="text-xs text-gray-400">
                    {rule.delayMinutes === 0
                      ? "Ngay lập tức"
                      : `Sau ${rule.delayMinutes} phút không phản hồi`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {policy.rotationPolicies.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <p className="text-xs text-gray-400 mb-1">Áp dụng cho:</p>
            <div className="flex flex-wrap gap-1.5">
              {policy.rotationPolicies.map((rp) => (
                <span key={rp.id} className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                  {rp.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
