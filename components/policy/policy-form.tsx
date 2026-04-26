"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Team { id: string; name: string; }
interface EscalationPolicy { id: string; name: string; teamId: string; }

interface TimeSlot {
  label: string;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  daysOfWeek?: number[];
}

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
    timeSlots?: TimeSlot[] | null;
    checklistRequired?: boolean;
    templateTasks?: string[] | null;
  };
}

function timeToHHMM(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseHHMM(value: string): { hour: number; minute: number } {
  const [h, m] = value.split(":").map(Number);
  return { hour: h ?? 0, minute: m ?? 0 };
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

  const initialSlots = initialData?.timeSlots ?? [];
  const [useTimeSlots, setUseTimeSlots] = useState(Array.isArray(initialSlots) && initialSlots.length > 0);
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>(
    Array.isArray(initialSlots) && initialSlots.length > 0
      ? initialSlots
      : []
  );

  const [checklistRequired, setChecklistRequired] = useState(initialData?.checklistRequired ?? false);
  const [templateTasks, setTemplateTasks] = useState<string[]>(
    Array.isArray(initialData?.templateTasks) && (initialData?.templateTasks?.length ?? 0) > 0
      ? (initialData.templateTasks as string[])
      : []
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(field: string, value: string | number) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  const teamEscalationPolicies = escalationPolicies.filter((p) => p.teamId === form.teamId);

  function addSlot() {
    setTimeSlots((prev) => [
      ...prev,
      { label: "Ca mới", startHour: 8, startMinute: 0, endHour: 16, endMinute: 0 },
    ]);
  }

  function removeSlot(index: number) {
    setTimeSlots((prev) => prev.filter((_, i) => i !== index));
  }

  function updateSlot(index: number, field: keyof TimeSlot, value: string | number) {
    setTimeSlots((prev) =>
      prev.map((slot, i) => (i === index ? { ...slot, [field]: value } : slot))
    );
  }

  function updateSlotTime(index: number, field: "start" | "end", value: string) {
    const { hour, minute } = parseHHMM(value);
    setTimeSlots((prev) =>
      prev.map((slot, i) =>
        i === index
          ? { ...slot, [`${field}Hour`]: hour, [`${field}Minute`]: minute }
          : slot
      )
    );
  }

  function toggleSlotDay(index: number, dow: number) {
    setTimeSlots((prev) =>
      prev.map((slot, i) => {
        if (i !== index) return slot;
        const allDays = [0, 1, 2, 3, 4, 5, 6];
        const current = (slot.daysOfWeek && slot.daysOfWeek.length > 0) ? slot.daysOfWeek : allDays;
        const next = current.includes(dow) ? current.filter((d) => d !== dow) : [...current, dow].sort();
        return { ...slot, daysOfWeek: next.length === 7 ? [] : next };
      })
    );
  }

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
      timeSlots: useTimeSlots ? timeSlots : [],
      checklistRequired,
      templateTasks: templateTasks.filter((t) => t.trim()),
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
    if (isEdit) {
      router.refresh();
      setLoading(false);
    } else {
      router.push(`/policies/${data.data.id}`);
    }
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

      {/* Time slots section */}
      <div className="border border-gray-200 rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="useTimeSlots"
            checked={useTimeSlots}
            onChange={(e) => setUseTimeSlots(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-blue-600"
          />
          <label htmlFor="useTimeSlots" className="text-sm font-medium text-gray-700">
            Dùng khung giờ cố định
          </label>
        </div>

        {useTimeSlots && (
          <div className="space-y-2">
            <p className="text-xs text-gray-500">
              Mỗi ngày trong khoảng tạo lịch sẽ có các ca theo khung giờ dưới đây.
            </p>
            {timeSlots.map((slot, index) => (
              <div key={index} className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50/50">
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    type="text"
                    value={slot.label}
                    onChange={(e) => updateSlot(index, "label", e.target.value)}
                    placeholder="Tên ca"
                    className="input text-sm w-28"
                  />
                  <input
                    type="time"
                    value={timeToHHMM(slot.startHour, slot.startMinute)}
                    onChange={(e) => updateSlotTime(index, "start", e.target.value)}
                    className="input text-sm"
                  />
                  <span className="text-gray-400 text-sm">–</span>
                  <input
                    type="time"
                    value={timeToHHMM(slot.endHour, slot.endMinute)}
                    onChange={(e) => updateSlotTime(index, "end", e.target.value)}
                    className="input text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => removeSlot(index)}
                    className="ml-auto text-xs px-2 py-1 text-red-500 hover:bg-red-50 rounded"
                  >
                    Xoá
                  </button>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs text-gray-500 mr-1">Áp dụng:</span>
                  {[
                    { dow: 1, label: "T2" }, { dow: 2, label: "T3" }, { dow: 3, label: "T4" },
                    { dow: 4, label: "T5" }, { dow: 5, label: "T6" }, { dow: 6, label: "T7" }, { dow: 0, label: "CN" },
                  ].map(({ dow, label }) => {
                    const active = !slot.daysOfWeek || slot.daysOfWeek.length === 0 || slot.daysOfWeek.includes(dow);
                    return (
                      <button
                        key={dow}
                        type="button"
                        onClick={() => toggleSlotDay(index, dow)}
                        className={`text-xs w-7 h-7 rounded-full font-medium transition-colors ${
                          active
                            ? "bg-indigo-600 text-white"
                            : "bg-white border border-gray-300 text-gray-500 hover:border-indigo-400"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                  <span className="text-xs text-gray-400 ml-1">
                    {(!slot.daysOfWeek || slot.daysOfWeek.length === 0) ? "(mọi ngày)" : ""}
                  </span>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={addSlot}
              className="text-xs px-3 py-1.5 bg-gray-50 border border-gray-200 text-gray-600 rounded hover:bg-gray-100"
            >
              + Thêm khung giờ
            </button>
          </div>
        )}
      </div>

      {/* Checklist template section */}
      <div className="border border-gray-200 rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="checklistRequired"
            checked={checklistRequired}
            onChange={(e) => setChecklistRequired(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-blue-600"
          />
          <label htmlFor="checklistRequired" className="text-sm font-medium text-gray-700">
            Bắt buộc hoàn thành checklist trước khi ca kết thúc
          </label>
        </div>

        <div className="space-y-2">
          <p className="text-xs text-gray-500">
            Các mục dưới đây sẽ tự động tạo checklist cho mỗi ca khi sinh lịch.
          </p>
          {templateTasks.map((task, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs text-gray-400 w-5 text-right">{i + 1}.</span>
              <input
                type="text"
                value={task}
                onChange={(e) => setTemplateTasks((prev) => prev.map((t, j) => j === i ? e.target.value : t))}
                placeholder="Tên công việc..."
                className="input text-sm flex-1"
              />
              <button
                type="button"
                onClick={() => setTemplateTasks((prev) => prev.filter((_, j) => j !== i))}
                className="text-xs px-2 py-1 text-red-500 hover:bg-red-50 rounded"
              >
                Xoá
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setTemplateTasks((prev) => [...prev, ""])}
            className="text-xs px-3 py-1.5 bg-gray-50 border border-gray-200 text-gray-600 rounded hover:bg-gray-100"
          >
            + Thêm mục checklist
          </button>
        </div>
      </div>

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
