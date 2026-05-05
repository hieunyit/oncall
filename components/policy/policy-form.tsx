"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  combineScheduleDateTime,
  normalizeScheduleIdentity,
  parseScheduleCsv,
} from "@/lib/schedule/csv-import";

interface TeamMemberOption {
  id: string;
  fullName: string;
  email: string;
}

interface Team {
  id: string;
  name: string;
  members: TeamMemberOption[];
}
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
    participantUserIds?: string[] | null;
    telegramRequirePhotoOnConfirm?: boolean;
    telegramEndShiftReminderEnabled?: boolean;
    telegramRequirePhotoOnCheckout?: boolean;
  };
}

interface CsvPreviewRow {
  line: number;
  startAtLabel: string;
  endAtLabel: string;
  assigneeLabel: string;
  backupLabel: string;
  notes: string;
  errors: string[];
}

const MINUTES = Array.from({ length: 60 }, (_, m) => m);

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function triggerFileDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function PolicyForm({ teams, defaultTeamId, escalationPolicies = [], initialData }: PolicyFormProps) {
  const router = useRouter();
  const isEdit = !!initialData;
  const teamMap = new Map(teams.map((team) => [team.id, team]));
  const initialTeamId = initialData?.teamId ?? defaultTeamId ?? teams[0]?.id ?? "";
  const initialTeamMembers = teamMap.get(initialTeamId)?.members ?? [];
  const initialSelectedMemberIds =
    initialData?.participantUserIds && initialData.participantUserIds.length > 0
      ? [...new Set(initialData.participantUserIds)]
      : initialTeamMembers.map((member) => member.id);

  const [form, setForm] = useState({
    teamId: initialTeamId,
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
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>(initialSelectedMemberIds);

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
  const [telegramRequirePhotoOnConfirm, setTelegramRequirePhotoOnConfirm] = useState(
    initialData?.telegramRequirePhotoOnConfirm ?? false
  );
  const [telegramEndShiftReminderEnabled, setTelegramEndShiftReminderEnabled] = useState(
    initialData?.telegramEndShiftReminderEnabled ?? false
  );
  const [telegramRequirePhotoOnCheckout, setTelegramRequirePhotoOnCheckout] = useState(
    initialData?.telegramRequirePhotoOnCheckout ?? false
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showReschedulePrompt, setShowReschedulePrompt] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [rescheduleResult, setRescheduleResult] = useState<{ removedShifts: number; newShifts: number } | null>(null);
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);
  const [importCsvFile, setImportCsvFile] = useState<File | null>(null);
  const [csvPreviewRows, setCsvPreviewRows] = useState<CsvPreviewRow[]>([]);
  const [csvPreviewErrors, setCsvPreviewErrors] = useState<string[]>([]);
  const [previewingCsv, setPreviewingCsv] = useState(false);

  function set(field: string, value: string | number) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  const selectedTeam = teamMap.get(form.teamId);
  const teamMembers = selectedTeam?.members ?? [];

  const teamEscalationPolicies = escalationPolicies.filter((p) => p.teamId === form.teamId);

  useEffect(() => {
    if (teamMembers.length === 0) {
      setSelectedMemberIds([]);
      return;
    }

    setSelectedMemberIds((prev) => {
      const allowedIds = new Set(teamMembers.map((member) => member.id));
      const intersection = prev.filter((id) => allowedIds.has(id));
      if (intersection.length > 0) return intersection;
      return teamMembers.map((member) => member.id);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.teamId]);

  useEffect(() => {
    if (!importCsvFile) return;
    setUseTimeSlots(false);
    void buildCsvPreview(importCsvFile);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importCsvFile, form.teamId, selectedMemberIds]);

  useEffect(() => {
    if (!telegramEndShiftReminderEnabled && telegramRequirePhotoOnCheckout) {
      setTelegramRequirePhotoOnCheckout(false);
    }
  }, [telegramEndShiftReminderEnabled, telegramRequirePhotoOnCheckout]);

  function toggleMember(memberId: string) {
    setSelectedMemberIds((prev) =>
      prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId]
    );
  }

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

  async function buildCsvPreview(file: File) {
    setPreviewingCsv(true);
    setCsvPreviewRows([]);
    setCsvPreviewErrors([]);

    try {
      const csvText = await file.text();
      const parsed = parseScheduleCsv(csvText);

      const byEmail = new Map(teamMembers.map((member) => [member.email.trim().toLowerCase(), member]));
      const byName = new Map<string, TeamMemberOption[]>();
      for (const member of teamMembers) {
        const key = normalizeScheduleIdentity(member.fullName);
        const list = byName.get(key) ?? [];
        list.push(member);
        byName.set(key, list);
      }

      const selectedMemberIdSet = new Set(selectedMemberIds);
      const previewRows: CsvPreviewRow[] = [];
      const errorSet = new Set<string>();
      const overlapCandidates = new Map<
        string,
        Array<{ line: number; startsAt: Date; endsAt: Date }>
      >();
      const dayCollisionSet = new Set<string>();

      for (const error of parsed.errors) {
        errorSet.add(`Dòng ${error.line}: ${error.message}`);
      }

      for (const row of parsed.rows) {
        const rowErrors: string[] = [];
        const startsAt = combineScheduleDateTime(row.startDateText, row.startTimeText);
        const endsAt = combineScheduleDateTime(row.endDateText, row.endTimeText);

        if (!startsAt) {
          rowErrors.push("startDate/startTime không đúng định dạng");
        }
        if (!endsAt) {
          rowErrors.push("endDate/endTime không đúng định dạng");
        }
        if (startsAt && endsAt && endsAt <= startsAt) {
          rowErrors.push("endDate/endTime phải sau startDate/startTime");
        }

        const assigneeRaw = row.assigneeText.trim();
        let assigneeResolved: TeamMemberOption | null = null;
        if (assigneeRaw.includes("@")) {
          assigneeResolved = byEmail.get(assigneeRaw.toLowerCase()) ?? null;
        } else {
          const matches = byName.get(normalizeScheduleIdentity(assigneeRaw)) ?? [];
          if (matches.length === 1) {
            assigneeResolved = matches[0];
          } else if (matches.length > 1) {
            rowErrors.push(`assignee "${assigneeRaw}" trùng tên, hãy dùng email`);
          }
        }

        if (!assigneeResolved) {
          rowErrors.push(`assignee "${assigneeRaw}" không thuộc team đã chọn`);
        } else if (!selectedMemberIdSet.has(assigneeResolved.id)) {
          rowErrors.push(`assignee "${assigneeRaw}" chưa nằm trong danh sách Policy members`);
        }

        if (row.backupText) {
          const backupRaw = row.backupText.trim();
          let backupResolved: TeamMemberOption | null = null;
          if (backupRaw.includes("@")) {
            backupResolved = byEmail.get(backupRaw.toLowerCase()) ?? null;
          } else {
            const matches = byName.get(normalizeScheduleIdentity(backupRaw)) ?? [];
            if (matches.length === 1) {
              backupResolved = matches[0];
            } else if (matches.length > 1) {
              rowErrors.push(`backup "${backupRaw}" trùng tên, hãy dùng email`);
            }
          }

          if (!backupResolved) {
            rowErrors.push(`backup "${backupRaw}" không thuộc team đã chọn`);
          } else if (assigneeResolved && backupResolved.id === assigneeResolved.id) {
            rowErrors.push("backup không được trùng assignee");
          }
        }

        if (assigneeResolved && startsAt && endsAt) {
          const overlapList = overlapCandidates.get(assigneeResolved.id) ?? [];
          overlapList.push({ line: row.line, startsAt, endsAt });
          overlapCandidates.set(assigneeResolved.id, overlapList);

          const dayKey = `${assigneeResolved.id}|${startsAt.toISOString().slice(0, 10)}`;
          if (dayCollisionSet.has(dayKey)) {
            rowErrors.push("assignee bị trùng nhiều ca cùng ngày");
          } else {
            dayCollisionSet.add(dayKey);
          }
        }

        previewRows.push({
          line: row.line,
          startAtLabel: `${row.startDateText} ${row.startTimeText}`,
          endAtLabel: `${row.endDateText} ${row.endTimeText}`,
          assigneeLabel: row.assigneeText,
          backupLabel: row.backupText ?? "",
          notes: row.notes ?? "",
          errors: rowErrors,
        });
      }

      for (const entries of overlapCandidates.values()) {
        const sorted = [...entries].sort(
          (a, b) => a.startsAt.getTime() - b.startsAt.getTime()
        );
        for (let idx = 1; idx < sorted.length; idx += 1) {
          const previous = sorted[idx - 1];
          const current = sorted[idx];
          if (current.startsAt < previous.endsAt && current.endsAt > previous.startsAt) {
            errorSet.add(`Dòng ${current.line}: assignee bị chồng thời gian giữa các ca`);
          }
        }
      }

      for (const row of previewRows) {
        for (const rowError of row.errors) {
          errorSet.add(`Dòng ${row.line}: ${rowError}`);
        }
      }

      setCsvPreviewRows(previewRows);
      setCsvPreviewErrors([...errorSet]);
    } finally {
      setPreviewingCsv(false);
    }
  }

  function handleImportFileSelected(file: File | null) {
    setImportCsvFile(file);
    if (!file) {
      setCsvPreviewRows([]);
      setCsvPreviewErrors([]);
      return;
    }
    void buildCsvPreview(file);
  }

  function downloadCsvImportTemplate() {
    const headers = [
      "startDate",
      "startTime",
      "endDate",
      "endTime",
      "assignee",
      "backup",
      "notes",
    ];
    const sampleRows = [
      [
        "2026-06-01",
        "08:00",
        "2026-06-01",
        "20:00",
        "member1@example.com",
        "member2@example.com",
        "Ca ngày",
      ],
      [
        "2026-06-01",
        "20:00",
        "2026-06-02",
        "08:00",
        "member2@example.com",
        "member3@example.com",
        "Ca đêm",
      ],
    ];
    const csv = [
      headers.join(","),
      ...sampleRows.map((row) => row.map((value) => csvEscape(value)).join(",")),
    ].join("\r\n");
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
    triggerFileDownload(blob, "mau-import-ca-truc.csv");
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
      memberIds: selectedMemberIds,
      telegramRequirePhotoOnConfirm,
      telegramEndShiftReminderEnabled,
      telegramRequirePhotoOnCheckout:
        telegramEndShiftReminderEnabled && telegramRequirePhotoOnCheckout,
    };

    if (selectedMemberIds.length === 0) {
      setError("Please select at least one member for this policy.");
      setLoading(false);
      return;
    }

    if (!isEdit && importCsvFile) {
      if (previewingCsv) {
        setError("Đang phân tích CSV, vui lòng chờ xong rồi lưu.");
        setLoading(false);
        return;
      }
      if (csvPreviewRows.length === 0) {
        setError("File CSV chưa có dữ liệu hợp lệ để import.");
        setLoading(false);
        return;
      }
      if (csvPreviewErrors.length > 0) {
        setError("CSV đang có lỗi. Vui lòng sửa lỗi trước khi tạo chính sách.");
        setLoading(false);
        return;
      }
    }

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
      setShowReschedulePrompt(false);
      setRescheduleResult(null);
      setRescheduleError(null);

      const outcome = await handleRescheduleNow({ silentIfNoBatch: true });
      if (outcome === "error") {
        setShowReschedulePrompt(true);
      } else {
        router.refresh();
      }
      setLoading(false);
    } else {
      const createdPolicyId = data?.data?.id as string | undefined;
      if (!createdPolicyId) {
        setError("Không nhận được policy id sau khi tạo chính sách");
        setLoading(false);
        return;
      }

      if (importCsvFile) {
        const importForm = new FormData();
        importForm.append("policyId", createdPolicyId);
        importForm.append("file", importCsvFile);

        const importRes = await fetch("/api/schedules/import", {
          method: "POST",
          body: importForm,
        });
        const importPayload = await importRes.json().catch(() => ({}));

        if (!importRes.ok) {
          const message =
            importPayload && typeof importPayload === "object" && "error" in importPayload
              ? String((importPayload as { error?: unknown }).error ?? "")
              : "Import CSV thất bại";
          const details =
            importPayload &&
            typeof importPayload === "object" &&
            "details" in importPayload &&
            Array.isArray((importPayload as { details?: unknown }).details)
              ? ((importPayload as { details?: Array<{ line?: number; message?: string }> }).details ?? [])
                  .slice(0, 5)
                  .map((item) => {
                    if (!item) return null;
                    if (!item.message) return null;
                    return `Dòng ${item.line ?? "?"}: ${item.message}`;
                  })
                  .filter((line): line is string => Boolean(line))
                  .join("\n")
              : "";

          alert(
            details
              ? `Tạo chính sách thành công nhưng import ca thất bại:\n${message}\n${details}`
              : `Tạo chính sách thành công nhưng import ca thất bại:\n${message}`
          );
          router.push(`/policies/${createdPolicyId}`);
          return;
        }

        const importedCount =
          importPayload &&
          typeof importPayload === "object" &&
          "data" in importPayload &&
          importPayload.data &&
          typeof importPayload.data === "object" &&
          "importedShiftCount" in importPayload.data
            ? Number((importPayload.data as { importedShiftCount?: unknown }).importedShiftCount ?? 0)
            : 0;

        alert(
          importedCount > 0
            ? `Tạo chính sách và import thành công ${importedCount} ca trực.`
            : "Tạo chính sách và import thành công."
        );
      }

      router.push(`/policies/${createdPolicyId}`);
    }
  }

  async function handleRescheduleNow(
    options?: { silentIfNoBatch?: boolean }
  ): Promise<"ok" | "skipped" | "error"> {
    if (!initialData?.id) return "skipped";
    setRescheduling(true);
    setRescheduleError(null);
    try {
      const res = await fetch(`/api/policies/${initialData.id}/reschedule-from-now`, {
        method: "POST",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = typeof json.code === "string" ? json.code : undefined;
        if (options?.silentIfNoBatch && (code === "NO_PUBLISHED_BATCH" || code === "BATCH_EXPIRED")) {
          return "skipped";
        }
        setRescheduleError(json.error ?? "Không thể tạo lại lịch trực.");
        return "error";
      }

      const d = json.data ?? json;
      setRescheduleResult({ removedShifts: d.removedShifts, newShifts: d.newShifts });
      return "ok";
    } catch {
      setRescheduleError("Không thể kết nối đến máy chủ.");
      return "error";
    } finally {
      setRescheduling(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      {/* Post-save: offer to regenerate the schedule */}
      {showReschedulePrompt && isEdit && !rescheduleResult && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-start justify-between gap-4">
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-900">Chính sách đã được cập nhật.</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Lịch trực hiện tại chưa phản ánh thay đổi. Bạn có muốn tạo lại các ca tương lai từ hôm nay không?
            </p>
            {rescheduleError && (
              <p className="text-xs text-red-600 mt-1">{rescheduleError}</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={async () => {
                const outcome = await handleRescheduleNow();
                if (outcome !== "error") {
                  router.refresh();
                }
              }}
              disabled={rescheduling}
              className="px-3 py-1.5 text-xs font-medium bg-amber-600 hover:bg-amber-700 text-white rounded-lg disabled:opacity-50 transition-colors"
            >
              {rescheduling ? "Đang tạo lại..." : "Tạo lại lịch"}
            </button>
            <button
              type="button"
              onClick={() => setShowReschedulePrompt(false)}
              className="px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 rounded-lg transition-colors"
            >
              Bỏ qua
            </button>
          </div>
        </div>
      )}

      {rescheduleResult && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 flex items-center justify-between gap-4">
          <p className="text-sm text-green-800">
            ✓ Đã xóa <strong>{rescheduleResult.removedShifts}</strong> ca cũ và tạo{" "}
            <strong>{rescheduleResult.newShifts}</strong> ca mới theo chính sách hiện tại.
          </p>
          <button
            type="button"
            onClick={() => setRescheduleResult(null)}
            className="text-xs text-green-700 hover:text-green-900 shrink-0"
          >
            ✕
          </button>
        </div>
      )}

      {rescheduleError && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <p className="text-sm text-red-700">{rescheduleError}</p>
        </div>
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

      <Field label="Policy members">
        <p className="text-xs text-gray-500 mb-2">
          Only selected members will be used when generating this policy schedule.
        </p>
        <div className="border border-gray-200 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedMemberIds(teamMembers.map((member) => member.id))}
              className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => setSelectedMemberIds([])}
              className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
            >
              Clear
            </button>
            <span className="text-xs text-gray-500 ml-auto">
              {selectedMemberIds.length}/{teamMembers.length}
            </span>
          </div>

          {teamMembers.length === 0 ? (
            <p className="text-xs text-red-600">Team has no members.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {teamMembers.map((member) => (
                <label
                  key={member.id}
                  className="flex items-start gap-2 rounded border border-gray-200 px-2 py-1.5 hover:border-indigo-300 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedMemberIds.includes(member.id)}
                    onChange={() => toggleMember(member.id)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm text-gray-900 truncate">{member.fullName}</span>
                    <span className="block text-xs text-gray-500 truncate">{member.email}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
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

      {!isEdit && (
        <Field label="Import ca trực từ CSV (tùy chọn)">
          <div className="rounded-lg border border-slate-300 bg-white p-3 space-y-3">
            <p className="text-xs text-slate-700">
              Định dạng bắt buộc theo cột tách riêng:{" "}
              <code className="text-[11px] bg-slate-100 px-1 py-0.5 rounded">
                startDate,startTime,endDate,endTime,assignee,backup,notes
              </code>
            </p>
            <p className="text-xs text-slate-600">
              `startDate/endDate`: `yyyy-MM-dd` hoặc `dd/MM/yyyy`; `startTime/endTime`: `HH:mm`
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={downloadCsvImportTemplate}
                className="text-xs px-2.5 py-1.5 border border-slate-300 rounded bg-slate-900 text-white hover:bg-slate-800"
              >
                Tải mẫu CSV
              </button>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => handleImportFileSelected(e.target.files?.[0] ?? null)}
                className="text-xs text-slate-700 file:mr-2 file:rounded file:border file:border-slate-300 file:bg-white file:px-2 file:py-1 file:text-xs file:text-slate-700 hover:file:bg-slate-100"
              />
              {importCsvFile && (
                <button
                  type="button"
                  onClick={() => handleImportFileSelected(null)}
                  className="text-xs px-2 py-1 border border-slate-300 rounded bg-white text-slate-600 hover:bg-slate-100"
                >
                  Bỏ file
                </button>
              )}
            </div>

            {importCsvFile && (
              <p className="text-xs text-slate-700">Đã chọn: {importCsvFile.name}</p>
            )}

            {previewingCsv && (
              <p className="text-xs text-indigo-700">Đang phân tích CSV...</p>
            )}

            {csvPreviewErrors.length > 0 && (
              <div className="rounded border border-rose-200 bg-rose-50 p-2">
                <p className="text-xs font-medium text-rose-700 mb-1">
                  CSV có {csvPreviewErrors.length} lỗi:
                </p>
                <ul className="text-xs text-rose-700 space-y-0.5 max-h-40 overflow-auto">
                  {csvPreviewErrors.slice(0, 20).map((error) => (
                    <li key={error}>- {error}</li>
                  ))}
                </ul>
              </div>
            )}

            {csvPreviewRows.length > 0 && (
              <div className="rounded border border-slate-200 overflow-hidden">
                <div className="px-2 py-1.5 bg-slate-100 text-xs text-slate-700 font-medium">
                  Preview {csvPreviewRows.length} dòng
                </div>
                <div className="overflow-auto max-h-56">
                  <table className="w-full text-xs text-slate-700">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr>
                        <th className="px-2 py-1 text-left">Dòng</th>
                        <th className="px-2 py-1 text-left">Bắt đầu</th>
                        <th className="px-2 py-1 text-left">Kết thúc</th>
                        <th className="px-2 py-1 text-left">Assignee</th>
                        <th className="px-2 py-1 text-left">Backup</th>
                        <th className="px-2 py-1 text-left">Lỗi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {csvPreviewRows.slice(0, 100).map((row) => (
                        <tr key={`${row.line}-${row.startAtLabel}-${row.assigneeLabel}`}>
                          <td className="px-2 py-1 align-top">{row.line}</td>
                          <td className="px-2 py-1 align-top">{row.startAtLabel}</td>
                          <td className="px-2 py-1 align-top">{row.endAtLabel}</td>
                          <td className="px-2 py-1 align-top">{row.assigneeLabel}</td>
                          <td className="px-2 py-1 align-top">{row.backupLabel || "-"}</td>
                          <td className="px-2 py-1 align-top">
                            {row.errors.length === 0 ? (
                              <span className="text-emerald-700">OK</span>
                            ) : (
                              <span className="text-rose-700">{row.errors.join("; ")}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </Field>
      )}

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

      <div className="border border-gray-200 rounded-lg p-4 space-y-3">
        <p className="text-sm font-medium text-gray-700">Tùy chọn xác nhận ca & Telegram</p>
        <div className="space-y-2 text-sm">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={telegramRequirePhotoOnConfirm}
              onChange={(e) => setTelegramRequirePhotoOnConfirm(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-gray-300 text-blue-600"
            />
            <span className="text-gray-700">
              Yêu cầu upload ảnh check-in khi xác nhận ca trực (Web + Telegram)
            </span>
          </label>

          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={telegramEndShiftReminderEnabled}
              onChange={(e) => setTelegramEndShiftReminderEnabled(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-gray-300 text-blue-600"
            />
            <span className="text-gray-700">
              Gửi nhắc hết ca qua Telegram
            </span>
          </label>

          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={telegramRequirePhotoOnCheckout}
              onChange={(e) => setTelegramRequirePhotoOnCheckout(e.target.checked)}
              disabled={!telegramEndShiftReminderEnabled}
              className="mt-0.5 w-4 h-4 rounded border-gray-300 text-blue-600 disabled:opacity-50"
            />
            <span className="text-gray-700">
              Khi nhắc hết ca, yêu cầu ảnh check-out để xác nhận kết ca
            </span>
          </label>
        </div>
      </div>

      {/* Time slots section */}
      {!importCsvFile ? (
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
                    <div className="flex items-center gap-0.5">
                      <select
                        value={slot.startHour}
                        onChange={(e) => updateSlot(index, "startHour", Number(e.target.value))}
                        className="input text-sm w-14 text-gray-900"
                      >
                        {Array.from({ length: 24 }, (_, h) => (
                          <option key={h} value={h}>{String(h).padStart(2, "0")}</option>
                        ))}
                      </select>
                      <span className="text-gray-400 text-xs px-0.5">:</span>
                      <select
                        value={slot.startMinute}
                        onChange={(e) => updateSlot(index, "startMinute", Number(e.target.value))}
                        className="input text-sm w-14 text-gray-900"
                      >
                        {MINUTES.map((m) => (
                          <option key={m} value={m}>{String(m).padStart(2, "0")}</option>
                        ))}
                      </select>
                    </div>
                    <span className="text-gray-400 text-sm">–</span>
                    <div className="flex items-center gap-0.5">
                      <select
                        value={slot.endHour}
                        onChange={(e) => updateSlot(index, "endHour", Number(e.target.value))}
                        className="input text-sm w-14 text-gray-900"
                      >
                        {Array.from({ length: 25 }, (_, h) => (
                          <option key={h} value={h}>{String(h).padStart(2, "0")}</option>
                        ))}
                      </select>
                      <span className="text-gray-400 text-xs px-0.5">:</span>
                      <select
                        value={slot.endMinute}
                        onChange={(e) => updateSlot(index, "endMinute", Number(e.target.value))}
                        className="input text-sm w-14 text-gray-900"
                      >
                        {MINUTES.map((m) => (
                          <option key={m} value={m}>{String(m).padStart(2, "0")}</option>
                        ))}
                      </select>
                    </div>
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
      ) : (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
          Đang dùng import CSV nên phần "Dùng khung giờ cố định" được ẩn.
        </div>
      )}

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
