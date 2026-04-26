"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TeamNotificationChannel } from "@/app/generated/prisma/client";

const CHANNEL_LABELS: Record<string, string> = { EMAIL: "Email", TELEGRAM: "Telegram", TEAMS: "Teams" };

const CHANNEL_CONFIG_FIELDS: Record<string, { key: string; label: string; placeholder: string }[]> = {
  EMAIL: [{ key: "address", label: "Địa chỉ email", placeholder: "team@company.com" }],
  TELEGRAM: [{ key: "chatId", label: "Chat ID", placeholder: "-100123456789" }],
  TEAMS: [{ key: "webhookUrl", label: "Webhook URL", placeholder: "https://outlook.office.com/webhook/..." }],
};

export function NotificationChannels({
  teamId,
  initial,
  isManager,
}: {
  teamId: string;
  initial: TeamNotificationChannel[];
  isManager: boolean;
}) {
  const router = useRouter();
  const [channels, setChannels] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState("EMAIL");
  const [name, setName] = useState("");
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; msg: string } | null>(null);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    const configJson: Record<string, string> = {};
    for (const field of CHANNEL_CONFIG_FIELDS[type] ?? []) {
      configJson[field.key] = configValues[field.key] ?? "";
    }
    const res = await fetch(`/api/teams/${teamId}/notification-channels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, name, configJson }),
    });
    setSaving(false);
    if (res.ok) {
      const { data } = await res.json();
      setChannels((prev) => [...prev, data]);
      setAdding(false);
      setName("");
      setConfigValues({});
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Không thể thêm kênh.");
    }
  };

  const handleTest = async (channelId: string) => {
    setTestingId(channelId);
    setTestResult(null);
    const res = await fetch(`/api/teams/${teamId}/notification-channels/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelId }),
    });
    const d = await res.json().catch(() => ({}));
    setTestResult({
      id: channelId,
      ok: res.ok,
      msg: res.ok ? (d.data?.message ?? "Thành công") : (d.error ?? "Lỗi không xác định"),
    });
    setTestingId(null);
    setTimeout(() => setTestResult(null), 5000);
  };

  const handleDelete = async (channelId: string) => {
    if (!confirm("Xóa kênh thông báo này?")) return;
    await fetch(`/api/teams/${teamId}/notification-channels`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelId }),
    });
    setChannels((prev) => prev.filter((c) => c.id !== channelId));
    router.refresh();
  };

  const fields = CHANNEL_CONFIG_FIELDS[type] ?? [];

  return (
    <div className="divide-y divide-gray-50">
      {channels.length === 0 && !adding && (
        <p className="px-5 py-6 text-sm text-gray-400 text-center">Chưa có kênh thông báo nào.</p>
      )}
      {channels.map((ch) => {
        const cfg = ch.configJson as Record<string, string>;
        const summary = Object.values(cfg).filter(Boolean).join(" · ");
        return (
          <div key={ch.id} className="px-5 py-3.5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                ch.type === "EMAIL" ? "bg-blue-100 text-blue-700" :
                ch.type === "TELEGRAM" ? "bg-sky-100 text-sky-700" :
                "bg-purple-100 text-purple-700"
              }`}>{CHANNEL_LABELS[ch.type] ?? ch.type}</span>
              <div>
                <p className="text-sm font-medium text-gray-900">{ch.name}</p>
                {summary && <p className="text-xs text-gray-400 truncate max-w-xs">{summary}</p>}
              </div>
            </div>
            {isManager && (
              <div className="flex items-center gap-2 shrink-0">
                {(ch.type === "TEAMS" || ch.type === "TELEGRAM") && (
                  <button
                    onClick={() => handleTest(ch.id)}
                    disabled={testingId === ch.id}
                    className="text-xs px-2 py-1 text-indigo-600 border border-indigo-200 rounded hover:bg-indigo-50 disabled:opacity-50"
                  >
                    {testingId === ch.id ? "Đang gửi..." : "Test"}
                  </button>
                )}
                <button
                  onClick={() => handleDelete(ch.id)}
                  className="text-xs text-red-400 hover:text-red-600 transition-colors"
                >
                  Xóa
                </button>
              </div>
            )}
            {testResult?.id === ch.id && (
              <div className={`mt-1.5 text-xs px-2 py-1 rounded w-full ${testResult.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                {testResult.ok ? "✓" : "✗"} {testResult.msg}
              </div>
            )}
          </div>
        );
      })}

      {isManager && (
        adding ? (
          <form onSubmit={handleAdd} className="px-5 py-4 space-y-3 bg-gray-50">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Loại kênh</label>
                <select className="input w-full text-sm" value={type} onChange={(e) => { setType(e.target.value); setConfigValues({}); }}>
                  <option value="EMAIL">Email</option>
                  <option value="TELEGRAM">Telegram</option>
                  <option value="TEAMS">Teams</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Tên hiển thị</label>
                <input className="input w-full text-sm" value={name} onChange={(e) => setName(e.target.value)} required placeholder="VD: Alert email" />
              </div>
            </div>
            {fields.map((f) => (
              <div key={f.key}>
                <label className="block text-xs font-medium text-gray-600 mb-1">{f.label}</label>
                <input
                  className="input w-full text-sm"
                  placeholder={f.placeholder}
                  value={configValues[f.key] ?? ""}
                  onChange={(e) => setConfigValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                />
              </div>
            ))}
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={saving} className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                {saving ? "Đang lưu..." : "Thêm kênh"}
              </button>
              <button type="button" onClick={() => setAdding(false)} className="text-xs px-3 py-1.5 text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
                Hủy
              </button>
            </div>
          </form>
        ) : (
          <div className="px-5 py-3">
            <button
              onClick={() => setAdding(true)}
              className="text-xs text-indigo-600 hover:text-indigo-700"
            >
              + Thêm kênh
            </button>
          </div>
        )
      )}
    </div>
  );
}
