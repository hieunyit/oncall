"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Team { id: string; name: string; }

export function NewIntegrationForm({ teams }: { teams: Team[] }) {
  const router = useRouter();
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [name, setName] = useState("");
  const [type, setType] = useState("GENERIC_WEBHOOK");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    const res = await fetch("/api/integrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId, name, type }),
    });
    setSaving(false);
    if (res.ok) {
      router.push("/integrations");
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Không thể tạo integration.");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1.5">Nhóm</label>
        <select className="input w-full" value={teamId} onChange={(e) => setTeamId(e.target.value)} required>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1.5">Tên integration</label>
        <input className="input w-full" value={name} onChange={(e) => setName(e.target.value)}
          required placeholder="VD: Grafana Production" />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1.5">Loại</label>
        <select className="input w-full" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="GENERIC_WEBHOOK">Generic Webhook</option>
          <option value="PROMETHEUS">Prometheus AlertManager</option>
          <option value="GRAFANA">Grafana</option>
        </select>
      </div>
      {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
      <div className="flex gap-3 pt-1">
        <button type="submit" disabled={saving}
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50">
          {saving ? "Đang tạo..." : "Tạo integration"}
        </button>
        <button type="button" onClick={() => router.back()}
          className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
          Hủy
        </button>
      </div>
    </form>
  );
}
