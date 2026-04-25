"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Team { id: string; name: string; }
interface EscalationPolicy { id: string; name: string; teamId: string; }

interface PolicyFormProps {
  teams: Team[];
  defaultTeamId?: string;
  escalationPolicies?: EscalationPolicy[];
  initialData?: {
    id: string;
    name: string;
    teamId: string;
    cadence: string;
    cronExpression?: string | null;
    shiftDurationHours: number;
    handoverOffsetMinutes: number;
    confirmationDueHours: number;
    reminderLeadHours: number[];
    maxGenerateWeeks: number;
    escalationPolicyId?: string | null;
  };
}

export function PolicyForm({ teams, defaultTeamId, escalationPolicies = [], initialData }: PolicyFormProps) {
  const router = useRouter();
  const isEdit = !!initialData;

  const [form, setForm] = useState({
    teamId: initialData?.teamId ?? defaultTeamId ?? teams[0]?.id ?? "",
    name: initialData?.name ?? "",
    cadence: initialData?.cadence ?? "WEEKLY",
    cronExpression: initialData?.cronExpression ?? "",
    shiftDurationHours: initialData?.shiftDurationHours ?? 168,
    handoverOffsetMinutes: initialData?.handoverOffsetMinutes ?? 0,
    confirmationDueHours: initialData?.confirmationDueHours ?? 24,
    reminderLeadHoursRaw: (initialData?.reminderLeadHours ?? [48, 24, 2]).join(", "),
    maxGenerateWeeks: initialData?.maxGenerateWeeks ?? 4,
    escalationPolicyId: initialData?.escalationPolicyId ?? "",
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(field: string, value: string | number) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  const teamEscalationPolicies = escalationPolicies.filter((p) => p.teamId === form.teamId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const reminderLeadHours = form.reminderLeadHoursRaw
      .split(",")
      .map((s) => parseInt(s.trim()))
      .filter((n) => !isNaN(n) && n > 0);

    const payload = {
      teamId: form.teamId,
      name: form.name,
      cadence: form.cadence,
      cronExpression: form.cadence === "CUSTOM_CRON" ? form.cronExpression : undefined,
      shiftDurationHours: Number(form.shiftDurationHours),
      handoverOffsetMinutes: Number(form.handoverOffsetMinutes),
      confirmationDueHours: Number(form.confirmationDueHours),
      reminderLeadHours,
      maxGenerateWeeks: Number(form.maxGenerateWeeks),
      escalationPolicyId: form.escalationPolicyId || null,
    };

    const url = isEdit ? `/api/policies/${initialData!.id}` : "/api/policies";
    const method = isEdit ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const d = await res.json();
      setError(d.error ?? "Có lỗi xảy ra");
      setLoading(false);
      return;
    }

    const data = await res.json();
    router.push(`/policies/${isEdit ? initialData!.id : data.data.id}`);
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      <Field label="Nhóm">
        <select
          required
          value={form.teamId}
          onChange={(e) => set("teamId", e.target.value)}
          className="input"
          disabled={isEdit}
        >
          <option value="">Chọn nhóm...</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </Field>

      <Field label="Tên chính sách">
        <input
          required
          type="text"
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="VD: Weekly on-call rotation"
          className="input"
        />
      </Field>

      <Field label="Chu kỳ">
        <select value={form.cadence} onChange={(e) => set("cadence", e.target.value)} className="input">
          <option value="DAILY">Hàng ngày</option>
          <option value="WEEKLY">Hàng tuần</option>
          <option value="CUSTOM_CRON">Tùy chỉnh (Cron)</option>
        </select>
      </Field>

      {form.cadence === "CUSTOM_CRON" && (
        <Field label="Cron expression">
          <input
            type="text"
            value={form.cronExpression}
            onChange={(e) => set("cronExpression", e.target.value)}
            placeholder="0 9 * * 1 (mỗi thứ Hai lúc 9:00)"
            className="input"
          />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Field label="Độ dài ca (giờ)">
          <input required type="number" min={1} max={168} value={form.shiftDurationHours}
            onChange={(e) => set("shiftDurationHours", e.target.value)} className="input" />
        </Field>
        <Field label="Offset bàn giao (phút)">
          <input type="number" min={0} value={form.handoverOffsetMinutes}
            onChange={(e) => set("handoverOffsetMinutes", e.target.value)} className="input" />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Xác nhận trước (giờ)">
          <input required type="number" min={1} value={form.confirmationDueHours}
            onChange={(e) => set("confirmationDueHours", e.target.value)} className="input" />
        </Field>
        <Field label="Nhắc nhở trước (giờ, cách nhau dấu phẩy)">
          <input type="text" value={form.reminderLeadHoursRaw}
            onChange={(e) => set("reminderLeadHoursRaw", e.target.value)}
            placeholder="48, 24, 2" className="input" />
        </Field>
      </div>

      <Field label="Tạo trước tối đa (tuần)">
        <input type="number" min={1} max={52} value={form.maxGenerateWeeks}
          onChange={(e) => set("maxGenerateWeeks", e.target.value)} className="input" />
      </Field>

      <Field label="Escalation Chain (tuỳ chọn)">
        <select
          value={form.escalationPolicyId}
          onChange={(e) => set("escalationPolicyId", e.target.value)}
          className="input"
        >
          <option value="">— Không dùng escalation —</option>
          {teamEscalationPolicies.map((ep) => (
            <option key={ep.id} value={ep.id}>{ep.name}</option>
          ))}
        </select>
        {form.teamId && teamEscalationPolicies.length === 0 && (
          <p className="text-xs text-gray-400 mt-1">
            Nhóm này chưa có escalation chain.{" "}
            <a href="/escalation/new" className="text-indigo-600 hover:underline">Tạo ngay →</a>
          </p>
        )}
      </Field>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={loading}
          className="px-5 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Đang lưu..." : isEdit ? "Cập nhật" : "Tạo chính sách"}
        </button>
        <button type="button" onClick={() => router.back()} className="px-4 py-2.5 text-gray-600 hover:text-gray-900">
          Huỷ
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
      {children}
    </div>
  );
}
