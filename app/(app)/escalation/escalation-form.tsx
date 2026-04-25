"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EscalationPolicy, EscalationRule } from "@/app/generated/prisma/client";
import { ChannelType, EscalationTarget } from "@/app/generated/prisma/enums";

type Team = { id: string; name: string };

type RuleRow = {
  key: number;
  stepOrder: number;
  target: EscalationTarget;
  delayMinutes: number;
  channelType: ChannelType;
  isActive: boolean;
};

const TARGET_OPTIONS = [
  { value: EscalationTarget.PRIMARY, label: "Primary on-call" },
  { value: EscalationTarget.BACKUP, label: "Backup on-call" },
  { value: EscalationTarget.MANAGER, label: "Manager nhóm" },
  { value: EscalationTarget.TEAM_CHANNEL, label: "Kênh nhóm" },
];

const CHANNEL_OPTIONS = [
  { value: ChannelType.EMAIL, label: "Email" },
  { value: ChannelType.TELEGRAM, label: "Telegram" },
  { value: ChannelType.TEAMS, label: "Teams" },
];

export function EscalationForm({
  teams,
  existing,
}: {
  teams: Team[];
  existing?: EscalationPolicy & { rules: EscalationRule[] };
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [teamId, setTeamId] = useState(existing?.teamId ?? teams[0]?.id ?? "");
  const [rules, setRules] = useState<RuleRow[]>(
    existing?.rules.map((r, i) => ({
      key: i,
      stepOrder: r.stepOrder,
      target: r.target,
      delayMinutes: r.delayMinutes,
      channelType: r.channelType,
      isActive: r.isActive,
    })) ?? []
  );
  const [nextKey, setNextKey] = useState(existing?.rules.length ?? 0);

  const addRule = () => {
    setRules((prev) => [
      ...prev,
      {
        key: nextKey,
        stepOrder: prev.length + 1,
        target: EscalationTarget.PRIMARY,
        delayMinutes: 0,
        channelType: ChannelType.EMAIL,
        isActive: true,
      },
    ]);
    setNextKey((k) => k + 1);
  };

  const removeRule = (key: number) => {
    setRules((prev) => {
      const next = prev.filter((r) => r.key !== key);
      return next.map((r, i) => ({ ...r, stepOrder: i + 1 }));
    });
  };

  const updateRule = (key: number, patch: Partial<RuleRow>) => {
    setRules((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);

    let policyId = existing?.id;

    if (!policyId) {
      const res = await fetch("/api/escalation-policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, name, description: description || undefined }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Không thể tạo policy.");
        setSaving(false);
        return;
      }
      const { data } = await res.json();
      policyId = data.id;
    } else {
      await fetch(`/api/escalation-policies/${policyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: description || null }),
      });
    }

    const rulesRes = await fetch(`/api/escalation-policies/${policyId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rules }),
    });
    if (!rulesRes.ok) {
      const d = await rulesRes.json().catch(() => ({}));
      setError(d.error ?? "Không thể lưu rules.");
      setSaving(false);
      return;
    }

    setSaving(false);
    router.push("/escalation");
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Tên chain</label>
            <input
              className="input w-full"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Ví dụ: Escalation crit"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Nhóm</label>
            <select
              className="input w-full"
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              disabled={!!existing}
            >
              {teams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">Mô tả (tuỳ chọn)</label>
          <input
            className="input w-full"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Mô tả ngắn về chain này"
          />
        </div>
      </div>

      {/* Rules builder */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-medium text-gray-900">Các bước leo thang</h3>
          <button
            type="button"
            onClick={addRule}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-indigo-200 text-indigo-700 hover:bg-indigo-50 transition-colors"
          >
            + Thêm bước
          </button>
        </div>
        <div className="divide-y divide-gray-50">
          {rules.length === 0 && (
            <p className="px-5 py-8 text-center text-sm text-gray-400">
              Chưa có bước nào. Nhấn "+ Thêm bước" để bắt đầu.
            </p>
          )}
          {rules.map((rule) => (
            <div key={rule.key} className="px-5 py-4 grid grid-cols-12 gap-3 items-center">
              <div className="col-span-1 flex items-center justify-center">
                <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center">
                  {rule.stepOrder}
                </span>
              </div>
              <div className="col-span-4">
                <label className="block text-xs text-gray-500 mb-1">Thông báo đến</label>
                <select
                  className="input w-full text-xs py-1.5"
                  value={rule.target}
                  onChange={(e) => updateRule(rule.key, { target: e.target.value as EscalationTarget })}
                >
                  {TARGET_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-3">
                <label className="block text-xs text-gray-500 mb-1">Kênh</label>
                <select
                  className="input w-full text-xs py-1.5"
                  value={rule.channelType}
                  onChange={(e) => updateRule(rule.key, { channelType: e.target.value as ChannelType })}
                >
                  {CHANNEL_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-3">
                <label className="block text-xs text-gray-500 mb-1">Trễ (phút)</label>
                <input
                  type="number"
                  min={0}
                  max={1440}
                  className="input w-full text-xs py-1.5"
                  value={rule.delayMinutes}
                  onChange={(e) => updateRule(rule.key, { delayMinutes: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div className="col-span-1 flex justify-end">
                <button
                  type="button"
                  onClick={() => removeRule(rule.key)}
                  className="text-gray-300 hover:text-red-500 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

      <div className="flex items-center gap-3 justify-end">
        <button
          type="button"
          onClick={() => router.back()}
          className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
        >
          Hủy
        </button>
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
        >
          {saving ? "Đang lưu..." : existing ? "Lưu thay đổi" : "Tạo chain"}
        </button>
      </div>
    </form>
  );
}
