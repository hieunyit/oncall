"use client";

import { useState } from "react";
import { ChannelType, NotificationUrgency } from "@/app/generated/prisma/enums";
import type { UserNotificationRule } from "@/app/generated/prisma/client";

type RuleRow = {
  key: number;
  stepOrder: number;
  channelType: ChannelType;
  delayMinutes: number;
  isActive: boolean;
};

const CHANNEL_OPTIONS = [
  { value: ChannelType.EMAIL, label: "Email" },
  { value: ChannelType.TELEGRAM, label: "Telegram" },
  { value: ChannelType.TEAMS, label: "Teams" },
];

const CHANNEL_ICONS: Record<ChannelType, string> = {
  EMAIL: "✉️",
  TELEGRAM: "✈️",
  TEAMS: "💬",
};

function RulesEditor({
  urgency,
  initial,
}: {
  urgency: NotificationUrgency;
  initial: UserNotificationRule[];
}) {
  const [rules, setRules] = useState<RuleRow[]>(
    initial.map((r, i) => ({
      key: i,
      stepOrder: r.stepOrder,
      channelType: r.channelType,
      delayMinutes: r.delayMinutes,
      isActive: r.isActive,
    }))
  );
  const [nextKey, setNextKey] = useState(initial.length);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const addRule = () => {
    setRules((prev) => [
      ...prev,
      { key: nextKey, stepOrder: prev.length + 1, channelType: ChannelType.EMAIL, delayMinutes: 0, isActive: true },
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

  const save = async () => {
    setSaving(true);
    setError("");
    setSaved(false);
    const res = await fetch("/api/users/me/notification-rules", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        urgency,
        rules: rules.map((r) => ({
          urgency,
          stepOrder: r.stepOrder,
          channelType: r.channelType,
          delayMinutes: r.delayMinutes,
          isActive: r.isActive,
        })),
      }),
    });
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Không thể lưu.");
    }
  };

  return (
    <div className="space-y-3">
      {rules.length === 0 ? (
        <p className="text-sm text-gray-400 italic">Chưa có bước nào. Mặc định sẽ dùng email.</p>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <div key={rule.key} className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-gray-100 text-gray-600 text-xs font-bold flex items-center justify-center shrink-0">
                {rule.stepOrder}
              </span>
              <select
                className="input flex-1 text-xs py-1.5"
                value={rule.channelType}
                onChange={(e) => updateRule(rule.key, { channelType: e.target.value as ChannelType })}
              >
                {CHANNEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {CHANNEL_ICONS[o.value]} {o.label}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-1 shrink-0">
                <input
                  type="number"
                  min={0}
                  max={120}
                  className="input w-16 text-xs py-1.5 text-center"
                  value={rule.delayMinutes}
                  onChange={(e) => updateRule(rule.key, { delayMinutes: parseInt(e.target.value) || 0 })}
                />
                <span className="text-xs text-gray-400 w-8">phút</span>
              </div>
              <button
                type="button"
                onClick={() => removeRule(rule.key)}
                className="text-gray-300 hover:text-red-400 transition-colors shrink-0"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={addRule}
          className="text-xs text-indigo-600 hover:text-indigo-700"
        >
          + Thêm bước
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
        >
          {saving ? "Đang lưu..." : "Lưu"}
        </button>
        {saved && <span className="text-xs text-green-600">✓ Đã lưu</span>}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </div>
  );
}

export function NotificationRulesForm({
  defaultRules,
  importantRules,
}: {
  defaultRules: UserNotificationRule[];
  importantRules: UserNotificationRule[];
}) {
  return (
    <div className="p-5 space-y-6">
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
          Thông báo thường (Default)
        </p>
        <p className="text-xs text-gray-400 mb-3">
          Ca trực sắp tới, nhắc nhở xác nhận ca, v.v.
        </p>
        <RulesEditor urgency={NotificationUrgency.DEFAULT} initial={defaultRules} />
      </div>
      <div className="pt-4 border-t border-gray-100">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
          Thông báo quan trọng (Important)
        </p>
        <p className="text-xs text-gray-400 mb-3">
          Escalation, sự cố, cần phản hồi ngay.
        </p>
        <RulesEditor urgency={NotificationUrgency.IMPORTANT} initial={importantRules} />
      </div>
    </div>
  );
}
