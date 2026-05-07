"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  format,
  addDays,
  startOfWeek,
  addWeeks,
  subWeeks,
  isSameMonth,
  differenceInMinutes,
  endOfWeek,
  endOfMonth,
} from "date-fns";
import { vi } from "date-fns/locale";
import { useRouter } from "next/navigation";
import { MonthCalendar } from "@/components/schedule/month-calendar";
import { MonthNav } from "@/components/schedule/month-nav";
import { WeekTimeline } from "@/components/schedule/week-timeline";
import { OverrideShiftModal } from "./override-shift-modal";
import { getAutoScheduleWarningMessage, hasAutoScheduleWarning } from "@/lib/rotation/auto-schedule-warning";
import { ShiftIncidentsPanel } from "./shift-incidents-panel";
import {
  buildScheduleCsvContent,
  buildScheduleExcelHtml,
  buildScheduleExportRows,
} from "@/lib/schedule/export";
import { buildScheduleBackupCsv } from "@/lib/schedule/backup";

export interface ShiftBlock {
  id: string;
  assigneeName: string;
  assigneeId: string;
  assigneeEmail: string;
  policyId: string;
  teamId: string;
  teamName?: string | null;
  policyName: string;
  startsAt: Date;
  endsAt: Date;
  status?: string;
  source?: string;
  confirmationStatus?: string | null;
  confirmationToken?: string | null;
  confirmationDueAt?: Date | null;
  confirmationRespondedAt?: Date | null;
  isMe: boolean;
  isOverride?: boolean;
  backupName?: string | null;
  notes?: string | null;
  checklistRequired?: boolean;
  checklistTotal?: number;
  checklistDone?: number;
  checkInAt?: Date | null;
  checkOutAt?: Date | null;
  checkInPhotoPath?: string | null;
  checkOutPhotoPath?: string | null;
}

interface TeamMember {
  id: string;
  fullName: string;
}

interface Team {
  id: string;
  name: string;
}

interface PolicyOption {
  id: string;
  name: string;
  teamId: string;
}

interface PolicyBackupPayload {
  id: string;
  name: string;
  cadence: string;
  cronExpression?: string | null;
  shiftDurationHours: number;
  handoverOffsetMinutes: number;
  confirmationDueHours: number;
  reminderLeadHours: number[];
  maxGenerateWeeks: number;
  timezone: string;
  timeSlots?: unknown;
  checklistRequired?: boolean;
  templateTasks?: string[] | null;
  telegramRequirePhotoOnConfirm?: boolean;
  telegramEndShiftReminderEnabled?: boolean;
  telegramRequirePhotoOnCheckout?: boolean;
  participantUserIds?: string[] | null;
  team: {
    name: string;
    description?: string | null;
    members: Array<{
      role: "MANAGER" | "MEMBER";
      order: number;
      user: {
        id: string;
        email: string;
        fullName: string;
      };
    }>;
  };
}

type ViewMode = "week" | "2week" | "month";

interface Props {
  monthStart: Date;
  shifts: ShiftBlock[];
  currentUserId: string;
  isManager: boolean;
  canRestoreBackup: boolean;
  teamMembers: TeamMember[];
  myTeams: Team[];
  teamId?: string;
  policyId?: string;
  policyOptions: PolicyOption[];
}

const CONFIRMATION_STATUS: Record<string, { label: string; className: string }> = {
  PENDING: { label: "Chờ xác nhận", className: "bg-yellow-100 text-yellow-700" },
  CONFIRMED: { label: "Đã xác nhận", className: "bg-green-100 text-green-700" },
  DECLINED: { label: "Đã từ chối", className: "bg-red-100 text-red-700" },
  EXPIRED: { label: "Đã hết hạn", className: "bg-gray-100 text-gray-500" },
};

function formatDuration(start: Date, end: Date): string {
  const totalMins = differenceInMinutes(end, start);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (m === 0) return `${h} giờ`;
  return `${h}g ${m}p`;
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

function localDayKeyInBrowser(date: Date): string {
  return new Intl.DateTimeFormat("en-CA").format(date);
}

function localDayKeysForWindowInBrowser(startsAt: Date, endsAt: Date): string[] {
  if (!(endsAt > startsAt)) return [localDayKeyInBrowser(startsAt)];

  const keys: string[] = [];
  const seen = new Set<string>();
  const cursor = new Date(startsAt);
  cursor.setHours(0, 0, 0, 0);

  let guard = 0;
  while (cursor.getTime() < endsAt.getTime() && guard < 400) {
    const day = localDayKeyInBrowser(cursor);
    if (!seen.has(day)) {
      seen.add(day);
      keys.push(day);
    }
    cursor.setDate(cursor.getDate() + 1);
    guard++;
  }

  const endProbe = new Date(endsAt.getTime() - 1);
  const tailKey = localDayKeyInBrowser(endProbe < startsAt ? startsAt : endProbe);
  if (!seen.has(tailKey)) {
    keys.push(tailKey);
  }

  return keys;
}

function collectSameDayDuplicateShiftIds(shifts: ShiftBlock[]): Set<string> {
  const dayUserCounts = new Map<string, number>();
  const touchedDayKeysByShift = new Map<string, string[]>();

  for (const shift of shifts) {
    const dayKeys = localDayKeysForWindowInBrowser(shift.startsAt, shift.endsAt);
    touchedDayKeysByShift.set(shift.id, dayKeys);

    for (const dayKey of dayKeys) {
      const key = `${shift.assigneeId}|${dayKey}`;
      dayUserCounts.set(key, (dayUserCounts.get(key) ?? 0) + 1);
    }
  }

  const duplicateDayUserKeys = new Set(
    [...dayUserCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([key]) => key)
  );

  const duplicateShiftIds = new Set<string>();
  for (const shift of shifts) {
    const dayKeys = touchedDayKeysByShift.get(shift.id) ?? [];
    if (dayKeys.some((dayKey) => duplicateDayUserKeys.has(`${shift.assigneeId}|${dayKey}`))) {
      duplicateShiftIds.add(shift.id);
    }
  }

  return duplicateShiftIds;
}

export function ScheduleView({
  monthStart,
  shifts,
  currentUserId,
  isManager,
  canRestoreBackup,
  teamMembers,
  myTeams,
  teamId,
  policyId,
  policyOptions,
}: Props) {
  const router = useRouter();
  const [view, setView] = useState<ViewMode>("month");
  const [highlightMe, setHighlightMe] = useState(false);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState(() => {
    const today = new Date();
    return isSameMonth(monthStart, today)
      ? startOfWeek(today, { weekStartsOn: 1 })
      : startOfWeek(monthStart, { weekStartsOn: 1 });
  });
  const [overrideShift, setOverrideShift] = useState<ShiftBlock | null>(null);
  const [selectedShift, setSelectedShift] = useState<ShiftBlock | null>(null);
  const [selectedDay, setSelectedDay] = useState<{ date: Date; shifts: ShiftBlock[] } | null>(null);
  const [restoreCsvFile, setRestoreCsvFile] = useState<File | null>(null);
  const [restoringBackup, setRestoringBackup] = useState(false);

  const numDays = view === "2week" ? 14 : 7;

  const prevPeriod = useCallback(() => {
    setWeekStart((ws) => subWeeks(ws, view === "2week" ? 2 : 1));
  }, [view]);

  const nextPeriod = useCallback(() => {
    setWeekStart((ws) => addWeeks(ws, view === "2week" ? 2 : 1));
  }, [view]);

  function goToday() {
    setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }));
  }

  // Keyboard navigation for week/timeline views
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (view === "month") return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowLeft") prevPeriod();
      else if (e.key === "ArrowRight") nextPeriod();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [view, prevPeriod, nextPeriod]);

  // Stats computed client-side from shifts
  const now = new Date();
  const weekFromNow = addDays(now, 7);
  const sameDayDuplicateShiftIds = useMemo(() => collectSameDayDuplicateShiftIds(shifts), [shifts]);
  const onCallNow = shifts.some((s) => s.isMe && s.startsAt <= now && s.endsAt > now);
  const upcomingCount = shifts.filter((s) => s.isMe && s.startsAt >= now && s.startsAt <= weekFromNow).length;
  const pendingCount = shifts.filter((s) => s.isMe && s.confirmationStatus === "PENDING").length;
  const warningCount = shifts.filter(
    (s) => hasAutoScheduleWarning(s.notes) || sameDayDuplicateShiftIds.has(s.id)
  ).length;
  const openDayDetails = useCallback((day: Date, dayShifts: ShiftBlock[]) => {
    const sorted = [...dayShifts].sort(
      (a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.endsAt.getTime() - b.endsAt.getTime()
    );
    setSelectedDay({ date: day, shifts: sorted });
  }, []);

  const weekEnd = addDays(weekStart, numDays - 1);
  const weekLabel = `${format(weekStart, "dd/MM")} – ${format(weekEnd, "dd/MM/yyyy")}`;
  const monthGridStart = useMemo(() => startOfWeek(monthStart, { weekStartsOn: 1 }), [monthStart]);
  const monthGridEnd = useMemo(
    () => endOfWeek(endOfMonth(monthStart), { weekStartsOn: 1 }),
    [monthStart]
  );
  const exportRange = useMemo(() => {
    const rangeStart = view === "month" ? monthGridStart : weekStart;
    const rangeEnd = view === "month" ? monthGridEnd : weekEnd;

    const start = new Date(rangeStart);
    start.setHours(0, 0, 0, 0);

    const end = new Date(rangeEnd);
    end.setHours(23, 59, 59, 999);

    return { start, end };
  }, [monthGridEnd, monthGridStart, view, weekEnd, weekStart]);

  const shiftsForExport = useMemo(
    () =>
      shifts
        .filter((shift) => {
          if (selectedPersonId && shift.assigneeId !== selectedPersonId) return false;
          return shift.startsAt <= exportRange.end && shift.endsAt >= exportRange.start;
        })
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.endsAt.getTime() - b.endsAt.getTime()),
    [exportRange.end, exportRange.start, selectedPersonId, shifts]
  );

  const exportRows = useMemo(
    () => buildScheduleExportRows(
      shiftsForExport.map((shift) => {
        const warning = getAutoScheduleWarningMessage(shift.notes);
        return {
          startsAt: shift.startsAt,
          endsAt: shift.endsAt,
          teamName: shift.teamName ?? "",
          policyName: shift.policyName,
          assigneeName: shift.assigneeName,
          backupName: shift.backupName ?? "",
          status: shift.status ?? "",
          confirmationStatus: shift.confirmationStatus ?? "",
          source: shift.source ?? "",
          checkInAt: shift.checkInAt ?? null,
          checkOutAt: shift.checkOutAt ?? null,
          checkInPhotoPath: shift.checkInPhotoPath ?? null,
          checkOutPhotoPath: shift.checkOutPhotoPath ?? null,
          note: warning ?? shift.notes ?? "",
        };
      }),
      { appBaseUrl: typeof window !== "undefined" ? window.location.origin : null }
    ),
    [shiftsForExport]
  );

  const exportFilePrefix = useMemo(() => {
    if (view === "month") return `lich-truc-${format(monthStart, "yyyy-MM")}`;
    return `lich-truc-${format(weekStart, "yyyyMMdd")}-${format(weekEnd, "yyyyMMdd")}`;
  }, [monthStart, view, weekEnd, weekStart]);

  const handleExportCsv = useCallback(() => {
    if (exportRows.length === 0) return;
    const csv = buildScheduleCsvContent(exportRows);
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
    triggerFileDownload(blob, `${exportFilePrefix}.csv`);
  }, [exportFilePrefix, exportRows]);

  const handleExportExcel = useCallback(() => {
    if (exportRows.length === 0) return;
    const html = buildScheduleExcelHtml(exportRows);
    const blob = new Blob(["\uFEFF", html], {
      type: "application/vnd.ms-excel;charset=utf-8;",
    });
    triggerFileDownload(blob, `${exportFilePrefix}.xls`);
  }, [exportFilePrefix, exportRows]);

  const handleExportBackupCsv = useCallback(async () => {
    if (!policyId) {
      alert("Vui lòng chọn đúng 1 chính sách trước khi xuất file backup/restore.");
      return;
    }

    const shiftsForBackup = shifts
      .filter((shift) => {
        if (shift.policyId !== policyId) return false;
        return shift.startsAt <= exportRange.end && shift.endsAt >= exportRange.start;
      })
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.endsAt.getTime() - b.endsAt.getTime());
    if (shiftsForBackup.length === 0) {
      alert("Không có ca trực trong phạm vi đang xem để xuất backup.");
      return;
    }

    try {
      const response = await fetch(`/api/policies/${policyId}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message =
          payload && typeof payload === "object" && "error" in payload
            ? String((payload as { error?: unknown }).error ?? "Không thể tải thông tin chính sách.")
            : "Không thể tải thông tin chính sách.";
        alert(message);
        return;
      }

      const policy =
        payload && typeof payload === "object" && "data" in payload
          ? ((payload as { data?: unknown }).data as PolicyBackupPayload | undefined)
          : undefined;
      if (!policy) {
        alert("Không nhận được dữ liệu chính sách để export backup.");
        return;
      }

      const teamMembers = [...(policy.team.members ?? [])].sort(
        (a, b) => a.order - b.order || a.user.email.localeCompare(b.user.email)
      );
      const memberById = new Map(teamMembers.map((member) => [member.user.id, member]));
      const participantUserIds = (policy.participantUserIds ?? []).filter(Boolean);
      const participantEmails =
        participantUserIds.length > 0
          ? participantUserIds
              .map((userId) => memberById.get(userId)?.user.email ?? null)
              .filter((email): email is string => Boolean(email))
          : teamMembers.map((member) => member.user.email);

      const csv = buildScheduleBackupCsv({
        metadata: {
          teamName: policy.team.name,
          teamDescription: policy.team.description ?? "",
          policyName: policy.name,
          cadence: policy.cadence,
          cronExpression: policy.cronExpression ?? "",
          shiftDurationHours: policy.shiftDurationHours,
          handoverOffsetMinutes: policy.handoverOffsetMinutes,
          confirmationDueHours: policy.confirmationDueHours,
          reminderLeadHours: policy.reminderLeadHours ?? [],
          maxGenerateWeeks: policy.maxGenerateWeeks,
          timezone: policy.timezone ?? "Asia/Ho_Chi_Minh",
          timeSlots: policy.timeSlots ?? [],
          checklistRequired: Boolean(policy.checklistRequired),
          templateTasks: policy.templateTasks ?? [],
          telegramRequirePhotoOnConfirm: Boolean(policy.telegramRequirePhotoOnConfirm),
          telegramEndShiftReminderEnabled: Boolean(policy.telegramEndShiftReminderEnabled),
          telegramRequirePhotoOnCheckout: Boolean(policy.telegramRequirePhotoOnCheckout),
          teamMembers: teamMembers.map((member) => ({
            email: member.user.email,
            fullName: member.user.fullName,
            role: member.role === "MANAGER" ? "MANAGER" : "MEMBER",
            order: member.order,
          })),
          participantUserEmails: participantEmails,
          exportRangeStart: exportRange.start,
          exportRangeEnd: exportRange.end,
        },
        shifts: shiftsForBackup.map((shift) => ({
          startsAt: shift.startsAt,
          endsAt: shift.endsAt,
          assigneeEmail: shift.assigneeEmail,
          notes: shift.notes ?? "",
        })),
      });

      const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
      triggerFileDownload(blob, `${exportFilePrefix}-backup.csv`);
    } catch {
      alert("Không thể export backup lúc này. Vui lòng thử lại.");
    }
  }, [exportFilePrefix, exportRange.end, exportRange.start, policyId, shifts]);

  const handleRestoreBackupCsv = useCallback(async () => {
    if (!canRestoreBackup) return;
    if (!restoreCsvFile) {
      alert("Vui lòng chọn file Backup CSV để khôi phục.");
      return;
    }

    setRestoringBackup(true);
    try {
      const formData = new FormData();
      formData.append("file", restoreCsvFile);

      const res = await fetch("/api/schedules/import", {
        method: "POST",
        body: formData,
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message =
          payload && typeof payload === "object" && "error" in payload
            ? String((payload as { error?: unknown }).error ?? "Khôi phục thất bại")
            : "Khôi phục thất bại";
        const details =
          payload &&
          typeof payload === "object" &&
          "details" in payload &&
          Array.isArray((payload as { details?: unknown }).details)
            ? ((payload as { details?: Array<{ line?: number; message?: string }> }).details ?? [])
                .slice(0, 8)
                .map((item) => {
                  if (!item?.message) return null;
                  return `Dòng ${item.line ?? "?"}: ${item.message}`;
                })
                .filter((line): line is string => Boolean(line))
                .join("\n")
            : "";

        alert(details ? `${message}\n${details}` : message);
        return;
      }

      const data =
        payload && typeof payload === "object" && "data" in payload && payload.data && typeof payload.data === "object"
          ? (payload.data as { policyId?: unknown; importedShiftCount?: unknown })
          : {};
      const createdPolicyId = typeof data.policyId === "string" ? data.policyId : "";
      const importedShiftCount = Number(data.importedShiftCount ?? 0);

      alert(
        importedShiftCount > 0
          ? `Khôi phục backup thành công ${importedShiftCount} ca trực.`
          : "Khôi phục backup thành công."
      );
      setRestoreCsvFile(null);
      if (createdPolicyId) {
        router.push(`/policies/${createdPolicyId}`);
      } else {
        router.refresh();
      }
    } finally {
      setRestoringBackup(false);
    }
  }, [canRestoreBackup, restoreCsvFile, router]);

  return (
    <>
      {/* Stats bar */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 bg-gradient-to-r from-indigo-50 to-blue-50 rounded-xl border border-indigo-100">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${onCallNow ? "bg-green-500 animate-pulse" : "bg-gray-300"}`}
          />
          <span className="text-sm font-medium text-gray-700">
            {onCallNow ? "Đang trực" : "Không đang trực"}
          </span>
        </div>
        <span className="hidden sm:block w-px h-4 bg-indigo-200" />
        <span className="text-sm text-gray-600">
          <span className="font-semibold text-indigo-700">{upcomingCount}</span> ca trong 7 ngày tới
        </span>
        {pendingCount > 0 && (
          <>
            <span className="hidden sm:block w-px h-4 bg-indigo-200" />
            <span className="flex items-center gap-1.5 text-sm text-amber-700">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
              <span className="font-semibold">{pendingCount}</span> ca chờ xác nhận
            </span>
          </>
        )}
        {warningCount > 0 && (
          <>
            <span className="hidden sm:block w-px h-4 bg-indigo-200" />
            <span className="flex items-center gap-1.5 text-sm text-amber-700">
              <span className="text-[12px] leading-none">⚠</span>
              <span className="font-semibold">{warningCount}</span> ca cảnh báo thiếu người
            </span>
          </>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Lịch trực</h1>

        <div className="flex flex-wrap items-center gap-2">
          {/* Team filter */}
          {myTeams.length > 0 && (
            <select
              defaultValue={teamId ?? ""}
              onChange={(e) => {
                setSelectedPersonId(null);
                const url = new URL(window.location.href);
                if (e.target.value) url.searchParams.set("teamId", e.target.value);
                else url.searchParams.delete("teamId");
                url.searchParams.delete("policyId");
                router.push(`${url.pathname}?${url.searchParams.toString()}`);
              }}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700"
            >
              <option value="">Tất cả nhóm</option>
              {myTeams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}

          {/* Policy filter */}
          {policyOptions.length > 0 && (
            <select
              defaultValue={policyId ?? ""}
              onChange={(e) => {
                const url = new URL(window.location.href);
                if (e.target.value) url.searchParams.set("policyId", e.target.value);
                else url.searchParams.delete("policyId");
                router.push(`${url.pathname}?${url.searchParams.toString()}`);
              }}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700"
            >
              <option value="">Tất cả chính sách</option>
              {policyOptions
                .filter((policy) => !teamId || policy.teamId === teamId)
                .map((policy) => (
                  <option key={policy.id} value={policy.id}>
                    {policy.name}
                  </option>
                ))}
            </select>
          )}

          {/* Person filter */}
          {teamMembers.length > 1 && (
            <select
              value={selectedPersonId ?? ""}
              onChange={(e) => setSelectedPersonId(e.target.value || null)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700"
            >
              <option value="">Tất cả người trực</option>
              {teamMembers.map((m) => (
                <option key={m.id} value={m.id}>{m.fullName}</option>
              ))}
            </select>
          )}

          {/* View toggle */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {(["week", "2week", "month"] as ViewMode[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  view === v
                    ? "bg-indigo-600 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                {v === "week" ? "Tuần" : v === "2week" ? "2 Tuần" : "Tháng"}
              </button>
            ))}
          </div>

          {/* Highlight my shifts */}
          <button
            onClick={() => setHighlightMe((h) => !h)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              highlightMe
                ? "bg-indigo-50 border-indigo-300 text-indigo-700"
                : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${highlightMe ? "bg-indigo-500" : "bg-gray-300"}`} />
            Ca của tôi
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportCsv}
              disabled={exportRows.length === 0}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Xuất CSV
            </button>
            <button
              onClick={handleExportExcel}
              disabled={exportRows.length === 0}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Xuất Excel
            </button>
            {isManager && (
              <button
                onClick={() => {
                  void handleExportBackupCsv();
                }}
                disabled={!policyId || exportRows.length === 0}
                title={!policyId ? "Chọn 1 chính sách để xuất backup/restore" : undefined}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Backup CSV
              </button>
            )}
          </div>

          {/* Nav */}
          {view === "month" ? (
            <MonthNav monthStart={monthStart} />
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={prevPeriod}
                title="← Arrow key"
                className="px-2 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"
              >
                ‹
              </button>
              <span className="text-sm font-medium text-gray-800 min-w-36 text-center">
                {weekLabel}
              </span>
              <button
                onClick={nextPeriod}
                title="→ Arrow key"
                className="px-2 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"
              >
                ›
              </button>
              <button
                onClick={goToday}
                className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-500"
              >
                Hôm nay
              </button>
            </div>
          )}
        </div>
      </div>

      {canRestoreBackup && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-indigo-900">
            Khôi phục Backup CSV (tự tạo team + policy nếu chưa có)
          </span>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setRestoreCsvFile(e.target.files?.[0] ?? null)}
            className="text-xs text-slate-700 file:mr-2 file:rounded file:border file:border-indigo-200 file:bg-white file:px-2 file:py-1 file:text-xs file:text-slate-700 hover:file:bg-indigo-100"
          />
          <button
            type="button"
            onClick={() => {
              void handleRestoreBackupCsv();
            }}
            disabled={!restoreCsvFile || restoringBackup}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-indigo-300 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {restoringBackup ? "Đang khôi phục..." : "Restore Backup"}
          </button>
          {restoreCsvFile && (
            <button
              type="button"
              onClick={() => setRestoreCsvFile(null)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-indigo-200 bg-white text-slate-700 hover:bg-indigo-100"
            >
              Bỏ file
            </button>
          )}
          {restoreCsvFile && <span className="text-xs text-indigo-700">Đã chọn: {restoreCsvFile.name}</span>}
        </div>
      )}

      {/* Calendar / Timeline */}
      {view === "month" ? (
        <MonthCalendar
          monthStart={monthStart}
          shifts={shifts}
          currentUserId={currentUserId}
          highlightMe={highlightMe}
          selectedPersonId={selectedPersonId}
          isManager={isManager}
          onDayClick={openDayDetails}
          onShiftClick={(shift) => setSelectedShift(shift)}
          onOverride={isManager ? (shift) => setOverrideShift(shift) : undefined}
        />
      ) : (
        <WeekTimeline
          weekStart={weekStart}
          numDays={numDays}
          shifts={shifts}
          currentUserId={currentUserId}
          highlightMe={highlightMe}
          selectedPersonId={selectedPersonId}
          onDayClick={openDayDetails}
          onShiftClick={(shift) => setSelectedShift(shift)}
        />
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 bg-gray-50 rounded-lg border border-gray-100 text-xs text-gray-500">
        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Chú thích:</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-400 inline-block" /> Đã xác nhận</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-yellow-300 inline-block" /> Chờ xác nhận</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> Từ chối</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-400 inline-block" /> Override</span>
        <span className="flex items-center gap-1.5"><span className="text-xs font-bold text-gray-500">⇄</span> Đổi ca</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-blue-50 border border-blue-200 inline-block" /> Thứ 7 / CN</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded border-2 border-orange-400 inline-block" /> Checklist chưa xong</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-50 border border-red-100 inline-block" /> Không có ca trực</span>
        <span className="flex items-center gap-1.5"><span className="text-xs font-bold text-amber-600">⚠</span> Cảnh báo thiếu người</span>
        {view !== "month" && (
          <span className="text-[10px] text-gray-400">← → để chuyển tuần</span>
        )}
        <span className="text-[10px] text-gray-400 ml-auto">Mỗi người trực có màu riêng</span>
      </div>

      {overrideShift && (
        <OverrideShiftModal
          shift={overrideShift}
          teamMembers={teamMembers}
          onClose={() => setOverrideShift(null)}
        />
      )}

      {selectedDay && (
        <DayDetailModal
          date={selectedDay.date}
          shifts={selectedDay.shifts}
          currentUserId={currentUserId}
          onClose={() => setSelectedDay(null)}
          onSelectShift={(shift) => {
            setSelectedDay(null);
            setSelectedShift(shift);
          }}
        />
      )}

      {selectedShift && (
        <ShiftDetailModal
          shift={selectedShift}
          onClose={() => setSelectedShift(null)}
          isManager={isManager}
          currentUserId={currentUserId}
          teamMembers={teamMembers}
          onOverride={
            isManager
              ? (s) => { setSelectedShift(null); setOverrideShift(s); }
              : undefined
          }
        />
      )}
    </>
  );
}

function DayDetailModal({
  date,
  shifts,
  currentUserId,
  onClose,
  onSelectShift,
}: {
  date: Date;
  shifts: ShiftBlock[];
  currentUserId: string;
  onClose: () => void;
  onSelectShift: (shift: ShiftBlock) => void;
}) {
  const sortedShifts = useMemo(
    () =>
      [...shifts].sort(
        (a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.endsAt.getTime() - b.endsAt.getTime()
      ),
    [shifts]
  );

  return (
    <div
      className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-2xl border border-gray-200 bg-white shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Lịch trực trong ngày</h2>
            <p className="text-sm text-gray-500 mt-1">
              {format(date, "EEEE, dd/MM/yyyy", { locale: vi })}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 bg-white"
          >
            Đóng
          </button>
        </div>

        <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
          <div className="text-sm text-gray-600">
            Tổng số ca: <span className="font-semibold text-gray-900">{sortedShifts.length}</span>
          </div>

          {sortedShifts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-500">
              Ngày này không có ca trực.
            </div>
          ) : (
            <div className="space-y-2">
              {sortedShifts.map((shift) => {
                const confirmMeta = shift.confirmationStatus
                  ? CONFIRMATION_STATUS[shift.confirmationStatus]
                  : null;
                const autoWarningMessage = getAutoScheduleWarningMessage(shift.notes);
                return (
                  <button
                    key={shift.id}
                    type="button"
                    onClick={() => onSelectShift(shift)}
                    className="w-full text-left rounded-xl border border-gray-200 bg-white hover:bg-indigo-50/40 transition-colors px-3 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-semibold text-gray-900 truncate">
                          {shift.teamName ? `${shift.teamName} · ${shift.policyName}` : shift.policyName}
                        </p>
                        <p className="text-sm text-gray-700 truncate">
                          {shift.assigneeName}
                          {shift.assigneeId === currentUserId ? " (Bạn)" : ""}
                        </p>
                        <p className="text-xs text-gray-500">
                          {format(shift.startsAt, "HH:mm dd/MM/yyyy")} - {format(shift.endsAt, "HH:mm dd/MM/yyyy")}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                        {autoWarningMessage && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
                            ⚠ Thiếu người
                          </span>
                        )}
                        {shift.source === "SWAP" && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                            Đổi ca
                          </span>
                        )}
                        {shift.isOverride && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                            Override
                          </span>
                        )}
                        {confirmMeta && (
                          <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${confirmMeta.className}`}>
                            {confirmMeta.label}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ShiftDetailModal({
  shift,
  onClose,
  isManager,
  currentUserId,
  teamMembers,
  onOverride,
}: {
  shift: ShiftBlock;
  onClose: () => void;
  isManager?: boolean;
  currentUserId?: string;
  teamMembers?: TeamMember[];
  onOverride?: (shift: ShiftBlock) => void;
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState<Array<{
    id: string;
    title: string;
    isCompleted: boolean;
    completedAt?: string | null;
    order?: number;
  }>>([]);
  const [tasksLoaded, setTasksLoaded] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [addingTask, setAddingTask] = useState(false);
  const [localConfirmStatus, setLocalConfirmStatus] = useState(shift.confirmationStatus);
  const [confirmLoading, setConfirmLoading] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState("");
  const [showSwapForm, setShowSwapForm] = useState(false);
  const [swapNote, setSwapNote] = useState("");
  const [swapLoading, setSwapLoading] = useState(false);
  const [swapSuccess, setSwapSuccess] = useState(false);
  const [swapError, setSwapError] = useState("");
  const [taskError, setTaskError] = useState("");
  const [taskTab, setTaskTab] = useState<"open" | "done">("open");
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTaskTitle, setEditingTaskTitle] = useState("");
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);

  const isMe = shift.assigneeId === currentUserId;
  const isPending = localConfirmStatus === "PENDING";
  const isActive = shift.status === "ACTIVE";
  const canRequestSwap = isMe && !isActive && shift.status !== "COMPLETED";
  const canManageChecklist = isMe || Boolean(isManager);
  const canEditChecklist = isMe && shift.startsAt <= new Date(Date.now() + 2 * 60 * 60 * 1000);

  useEffect(() => {
    setTaskError("");
    fetch(`/api/shifts/${shift.id}/tasks`)
      .then((r) => r.json())
      .then((d) => { setTasks(d.data ?? []); setTasksLoaded(true); })
      .catch(() => {
        setTaskError("Không thể tải checklist.");
        setTasksLoaded(true);
      });
  }, [shift.id]);

  async function handleConfirmAction(action: "confirm" | "decline") {
    if (!shift.confirmationToken) return;
    setConfirmLoading(action);
    setConfirmError("");
    const res = await fetch(`/api/confirmations/${shift.confirmationToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setConfirmLoading(null);
    if (res.ok) {
      setLocalConfirmStatus(action === "confirm" ? "CONFIRMED" : "DECLINED");
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      setConfirmError(d.error ?? "Không thể xử lý yêu cầu.");
    }
  }

  async function handleSwapRequest() {
    setSwapLoading(true);
    setSwapError("");
    const res = await fetch("/api/swaps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        originalShiftId: shift.id,
        requesterNote: swapNote || undefined,
      }),
    });
    setSwapLoading(false);
    if (res.ok) {
      setSwapSuccess(true);
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      setSwapError(d.error ?? "Không thể tạo yêu cầu đổi ca.");
    }
  }

  function getApiError(payload: unknown, fallback: string): string {
    if (payload && typeof payload === "object" && "error" in payload) {
      const error = (payload as { error?: unknown }).error;
      if (typeof error === "string" && error.trim()) return error;
    }
    return fallback;
  }

  async function handleAddTask() {
    if (!canManageChecklist || !newTaskTitle.trim()) return;
    setAddingTask(true);
    setTaskError("");
    const res = await fetch(`/api/shifts/${shift.id}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTaskTitle.trim() }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setTaskError(getApiError(json, "Không thể thêm mục checklist."));
      setAddingTask(false);
      return;
    }
    setTasks((prev) => [...prev, (json as { data: (typeof tasks)[number] }).data]);
    setNewTaskTitle("");
    setAddingTask(false);
  }

  async function handleTaskInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      await handleAddTask();
    }
  }

  async function handleToggleTask(taskId: string, current: boolean) {
    if (!canEditChecklist) return;
    setTaskError("");
    const res = await fetch(`/api/shifts/${shift.id}/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isCompleted: !current }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setTaskError(getApiError(json, "Không thể cập nhật checklist."));
      return;
    }

    const updated = (json as { data?: (typeof tasks)[number] }).data;
    if (updated) {
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...updated } : t)));
    } else {
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, isCompleted: !current } : t)));
    }
  }

  async function handleToggleMany(targetCompleted: boolean) {
    if (!canEditChecklist) return;
    const targetTasks = tasks.filter((t) => t.isCompleted !== targetCompleted);
    if (targetTasks.length === 0) return;

    setBulkUpdating(true);
    setTaskError("");

    const results = await Promise.all(
      targetTasks.map(async (task) => {
        const res = await fetch(`/api/shifts/${shift.id}/tasks/${task.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isCompleted: targetCompleted }),
        });
        const json = await res.json().catch(() => ({}));
        return { id: task.id, ok: res.ok, payload: json };
      })
    );

    const failed = results.filter((r) => !r.ok).length;
    const successful = new Map<string, (typeof tasks)[number]>();
    for (const result of results) {
      if (result.ok) {
        const updated = (result.payload as { data?: (typeof tasks)[number] }).data;
        if (updated) {
          successful.set(result.id, updated);
        } else {
          successful.set(result.id, { id: result.id, title: "", isCompleted: targetCompleted });
        }
      }
    }

    setTasks((prev) =>
      prev.map((task) => {
        const updated = successful.get(task.id);
        if (!updated) return task;
        return {
          ...task,
          ...updated,
          title: updated.title || task.title,
          isCompleted: targetCompleted,
          completedAt:
            updated.completedAt !== undefined
              ? updated.completedAt
              : targetCompleted
                ? new Date().toISOString()
                : null,
        };
      })
    );

    if (failed > 0) {
      setTaskError(`Không thể cập nhật ${failed}/${targetTasks.length} mục.`);
    }
    setBulkUpdating(false);
  }

  function startEditingTask(task: (typeof tasks)[number]) {
    if (!canManageChecklist) return;
    setEditingTaskId(task.id);
    setEditingTaskTitle(task.title);
    setTaskError("");
  }

  function cancelEditingTask() {
    setEditingTaskId(null);
    setEditingTaskTitle("");
  }

  async function saveTaskTitle(taskId: string) {
    if (!canManageChecklist || !editingTaskTitle.trim()) return;
    setTaskError("");
    const res = await fetch(`/api/shifts/${shift.id}/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: editingTaskTitle.trim() }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setTaskError(getApiError(json, "Không thể cập nhật tiêu đề checklist."));
      return;
    }
    const updated = (json as { data?: (typeof tasks)[number] }).data;
    setTasks((prev) =>
      prev.map((task) => (task.id === taskId ? { ...task, ...(updated ?? {}), title: editingTaskTitle.trim() } : task))
    );
    cancelEditingTask();
  }

  async function handleDeleteTask(taskId: string) {
    if (!canManageChecklist) return;
    setDeletingTaskId(taskId);
    setTaskError("");
    const res = await fetch(`/api/shifts/${shift.id}/tasks/${taskId}`, { method: "DELETE" });
    if (res.ok) {
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      if (editingTaskId === taskId) cancelEditingTask();
    } else {
      const json = await res.json().catch(() => ({}));
      setTaskError(getApiError(json, "Không thể xóa mục checklist."));
    }
    setDeletingTaskId(null);
  }

  const orderedTasks = useMemo(() => {
    return [...tasks].sort((a, b) => {
      const byOrder = (a.order ?? 0) - (b.order ?? 0);
      if (byOrder !== 0) return byOrder;
      return a.title.localeCompare(b.title, "vi");
    });
  }, [tasks]);

  const openTasks = useMemo(
    () => orderedTasks.filter((task) => !task.isCompleted),
    [orderedTasks]
  );
  const doneTasksList = useMemo(
    () =>
      orderedTasks
        .filter((task) => task.isCompleted)
        .sort((a, b) => {
          const at = a.completedAt ? new Date(a.completedAt).getTime() : 0;
          const bt = b.completedAt ? new Date(b.completedAt).getTime() : 0;
          return bt - at;
        }),
    [orderedTasks]
  );

  const visibleTasks = taskTab === "open" ? openTasks : doneTasksList;
  const totalTasks = tasks.length;
  const doneTasks = doneTasksList.length;
  const completionPercent = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
  const allDone = totalTasks > 0 && doneTasks === totalTasks;
  const duration = formatDuration(shift.startsAt, shift.endsAt);
  const confirmInfo = localConfirmStatus ? CONFIRMATION_STATUS[localConfirmStatus] : null;
  const autoWarningMessage = getAutoScheduleWarningMessage(shift.notes);
  const displayNotes =
    shift.notes && hasAutoScheduleWarning(shift.notes)
      ? autoWarningMessage
      : shift.notes;

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b flex items-center justify-between sticky top-0 bg-white z-10">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-gray-900">Chi tiết ca trực</h2>
            {isActive && (
              <span className="flex items-center gap-1 text-xs text-green-700 bg-green-100 px-2 py-0.5 rounded-full font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                Đang diễn ra
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Shift info */}
        <div className="px-5 py-4 space-y-3 border-b border-gray-100">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Người trực</p>
              <p className="font-bold text-gray-900 text-base leading-tight">{shift.assigneeName}</p>
              {isMe && <p className="text-xs text-indigo-600 font-medium mt-0.5">Bạn</p>}
            </div>
            <div className="flex flex-wrap gap-1.5 justify-end mt-0.5">
              {autoWarningMessage && (
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700">
                  ⚠ Thiếu người
                </span>
              )}
              {confirmInfo && (
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${confirmInfo.className}`}>
                  {confirmInfo.label}
                </span>
              )}
              {shift.isOverride && (
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700">Override</span>
              )}
            </div>
          </div>

          <div>
            <p className="text-xs text-gray-400 mb-0.5">Nhóm / Chính sách</p>
            <p className="text-sm text-gray-700">
              {shift.teamName && <span className="font-medium">{shift.teamName}</span>}
              {shift.teamName && <span className="text-gray-400 mx-1.5">·</span>}
              {shift.policyName}
            </p>
          </div>

          <div>
            <p className="text-xs text-gray-400 mb-0.5">Thời gian</p>
            <p className="text-sm text-gray-700">
              {format(shift.startsAt, "HH:mm dd/MM/yyyy")}
              <span className="text-gray-400 mx-1">→</span>
              {format(shift.endsAt, "HH:mm dd/MM/yyyy")}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">Thời lượng: {duration}</p>
          </div>

          {shift.backupName && (
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Người dự phòng</p>
              <p className="text-sm text-gray-700 flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                {shift.backupName}
              </p>
            </div>
          )}

          {displayNotes && (
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Ghi chú</p>
              <p className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2 leading-relaxed">{displayNotes}</p>
            </div>
          )}

          {/* Lifecycle */}
          <div className="pt-1 border-t border-gray-100 space-y-1.5">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Vòng đời</p>
            {shift.source === "SWAP" && (
              <div className="flex items-center gap-2 text-xs text-indigo-700 bg-indigo-50 rounded px-2 py-1">
                <span>⇄</span><span>Ca được tạo từ đổi ca</span>
              </div>
            )}
            {shift.isOverride && (
              <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">
                <span>Override</span>
              </div>
            )}
            {autoWarningMessage && (
              <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">
                <span>⚠</span>
                <span>{autoWarningMessage}</span>
              </div>
            )}
            {shift.confirmationDueAt && (
              <p className="text-xs text-gray-500">
                Hạn xác nhận:{" "}
                <span className="font-medium text-gray-700">
                  {format(shift.confirmationDueAt, "HH:mm dd/MM/yyyy")}
                </span>
              </p>
            )}
            {shift.confirmationRespondedAt && (
              <p className="text-xs text-gray-500">
                {localConfirmStatus === "CONFIRMED" ? "Đã xác nhận" : "Đã từ chối"} lúc:{" "}
                <span className="font-medium text-gray-700">
                  {format(shift.confirmationRespondedAt, "HH:mm dd/MM/yyyy")}
                </span>
              </p>
            )}
          </div>
        </div>

        {/* Actions */}
        {(isMe || isManager) && (
          <div className="px-5 py-4 border-b border-gray-100 space-y-2">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Thao tác</p>

            {/* Confirm / Decline */}
            {isMe && isPending && shift.confirmationToken && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <button
                    onClick={() => handleConfirmAction("confirm")}
                    disabled={!!confirmLoading}
                    className="flex-1 py-2.5 px-3 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
                  >
                    {confirmLoading === "confirm" ? "Đang xử lý..." : "✓ Xác nhận ca trực"}
                  </button>
                  <button
                    onClick={() => handleConfirmAction("decline")}
                    disabled={!!confirmLoading}
                    className="flex-1 py-2.5 px-3 bg-white border border-red-300 text-red-600 text-sm font-medium rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
                  >
                    {confirmLoading === "decline" ? "Đang xử lý..." : "✗ Từ chối ca"}
                  </button>
                </div>
                {confirmError && (
                  <p className="text-xs text-red-600 bg-red-50 px-3 py-1.5 rounded">{confirmError}</p>
                )}
              </div>
            )}

            {/* Request swap */}
            {canRequestSwap && !swapSuccess && (
              <div>
                {!showSwapForm ? (
                  <button
                    onClick={() => setShowSwapForm(true)}
                    className="w-full py-2.5 px-3 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                    Yêu cầu đổi ca
                  </button>
                ) : (
                  <div className="border border-indigo-200 rounded-lg p-3 space-y-3 bg-indigo-50/40">
                    <p className="text-xs font-medium text-gray-700">
                      Đăng yêu cầu đổi ca — bất kỳ thành viên nào trong nhóm có thể nhận
                    </p>
                    <textarea
                      value={swapNote}
                      onChange={(e) => setSwapNote(e.target.value)}
                      placeholder="Lý do đổi ca (tuỳ chọn)..."
                      rows={2}
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
                    />
                    {swapError && <p className="text-xs text-red-600">{swapError}</p>}
                    <div className="flex gap-2">
                      <button
                        onClick={handleSwapRequest}
                        disabled={swapLoading}
                        className="flex-1 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                      >
                        {swapLoading ? "Đang gửi..." : "Gửi yêu cầu"}
                      </button>
                      <button
                        onClick={() => setShowSwapForm(false)}
                        className="px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 bg-white"
                      >
                        Hủy
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {swapSuccess && (
              <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2.5 text-sm text-green-700 flex items-center gap-2">
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Yêu cầu đổi ca đã được đăng
              </div>
            )}

            {/* Override (manager only) */}
            {isManager && onOverride && (
              <button
                onClick={() => onOverride(shift)}
                className="w-full py-2.5 px-3 bg-amber-50 border border-amber-200 text-amber-700 text-sm font-medium rounded-lg hover:bg-amber-100 transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Override ca trực
              </button>
            )}
          </div>
        )}

        <div className="px-5 py-4 border-b border-gray-100">
          <ShiftIncidentsPanel
            shiftId={shift.id}
            teamId={shift.teamId}
            policyId={shift.policyId}
            assigneeId={shift.assigneeId}
            startsAt={shift.startsAt}
            teamMembers={teamMembers ?? []}
            canCreate={isMe}
            canManage={isMe || Boolean(isManager)}
          />
        </div>

        {/* Checklist */}
        <div className="px-5 py-4">
          <div className="rounded-xl border border-gray-200 bg-white p-3 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Checklist theo ca</h3>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Hạn checklist: {format(shift.endsAt, "HH:mm dd/MM/yyyy")}
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap justify-end">
                {shift.checklistRequired ? (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
                    Bắt buộc
                  </span>
                ) : (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">
                    Tùy chọn
                  </span>
                )}
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                    allDone ? "bg-green-100 text-green-700" : totalTasks === 0 ? "bg-gray-100 text-gray-600" : "bg-blue-100 text-blue-700"
                  }`}
                >
                  {totalTasks === 0 ? "Chưa có mục" : allDone ? "Hoàn tất" : `${doneTasks}/${totalTasks}`}
                </span>
              </div>
            </div>

            {tasksLoaded && totalTasks > 0 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] text-gray-500">
                  <span>Tiến độ</span>
                  <span className="font-medium text-gray-700">{completionPercent}%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${allDone ? "bg-green-500" : "bg-blue-500"}`}
                    style={{ width: `${completionPercent}%` }}
                  />
                </div>
              </div>
            )}

            {taskError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2.5 py-1.5">
                {taskError}
              </p>
            )}

            {isMe && !canEditChecklist && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">
                Checklist chỉ mở trước 2h khi bắt đầu ca trực.
              </p>
            )}

            {!tasksLoaded ? (
              <p className="text-xs text-gray-500">Đang tải checklist...</p>
            ) : (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setTaskTab("open")}
                      className={`px-2.5 py-1 text-xs font-medium ${
                        taskTab === "open" ? "bg-indigo-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      Chưa xong ({openTasks.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setTaskTab("done")}
                      className={`px-2.5 py-1 text-xs font-medium ${
                        taskTab === "done" ? "bg-indigo-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      Đã xong ({doneTasksList.length})
                    </button>
                  </div>

                  {canEditChecklist && totalTasks > 0 && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleToggleMany(true)}
                        disabled={bulkUpdating || openTasks.length === 0}
                        className="text-[11px] px-2 py-1 rounded border border-green-200 text-green-700 bg-green-50 hover:bg-green-100 disabled:opacity-50"
                      >
                        Hoàn tất tất cả
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleMany(false)}
                        disabled={bulkUpdating || doneTasksList.length === 0}
                        className="text-[11px] px-2 py-1 rounded border border-gray-200 text-gray-600 bg-white hover:bg-gray-50 disabled:opacity-50"
                      >
                        Mở lại tất cả
                      </button>
                    </div>
                  )}
                </div>

                {visibleTasks.length === 0 ? (
                  <p className="text-xs text-gray-500">
                    {taskTab === "open" ? "Không còn mục đang mở." : "Chưa có mục nào hoàn thành."}
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {visibleTasks.map((task) => {
                      const isEditing = editingTaskId === task.id;
                      const completedAt =
                        task.completedAt && !Number.isNaN(new Date(task.completedAt).getTime())
                          ? format(new Date(task.completedAt), "HH:mm dd/MM")
                          : null;

                      return (
                        <div
                          key={task.id}
                          className={`group rounded-lg border px-2.5 py-2 ${
                            task.isCompleted ? "border-green-100 bg-green-50/40" : "border-gray-200 bg-white"
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            <input
                              type="checkbox"
                              checked={task.isCompleted}
                              onChange={() => handleToggleTask(task.id, task.isCompleted)}
                              disabled={!canEditChecklist || bulkUpdating}
                              className="mt-0.5 w-4 h-4 rounded border-gray-300 text-blue-600 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                              title={canEditChecklist ? undefined : "Chỉ có người trực mới được tick checklist"}
                            />

                            <div className="flex-1 min-w-0">
                              {isEditing ? (
                                <div className="space-y-1.5">
                                  <input
                                    type="text"
                                    value={editingTaskTitle}
                                    onChange={(e) => setEditingTaskTitle(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        void saveTaskTitle(task.id);
                                      }
                                      if (e.key === "Escape") {
                                        e.preventDefault();
                                        cancelEditingTask();
                                      }
                                    }}
                                    className="w-full text-sm border border-indigo-200 rounded px-2 py-1 text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                  />
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => saveTaskTitle(task.id)}
                                      className="text-[11px] px-2 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700"
                                    >
                                      Lưu
                                    </button>
                                    <button
                                      type="button"
                                      onClick={cancelEditingTask}
                                      className="text-[11px] px-2 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50"
                                    >
                                      Hủy
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <p className={`text-sm leading-relaxed ${task.isCompleted ? "text-gray-500 line-through" : "text-gray-800"}`}>
                                    {task.title}
                                  </p>
                                  {task.isCompleted && completedAt && (
                                    <p className="text-[11px] text-green-700 mt-0.5">Hoàn thành lúc {completedAt}</p>
                                  )}
                                </>
                              )}
                            </div>

                            {canManageChecklist && !isEditing && (
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  type="button"
                                  onClick={() => startEditingTask(task)}
                                  className="text-[11px] px-1.5 py-0.5 rounded border border-gray-200 text-gray-500 hover:text-indigo-700 hover:border-indigo-200"
                                >
                                  Sửa
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteTask(task.id)}
                                  disabled={deletingTaskId === task.id}
                                  className="text-[11px] px-1.5 py-0.5 rounded border border-red-200 text-red-500 hover:bg-red-50 disabled:opacity-50"
                                >
                                  Xóa
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {canManageChecklist ? (
                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="text"
                      placeholder="Thêm mục checklist mới..."
                      value={newTaskTitle}
                      onChange={(e) => setNewTaskTitle(e.target.value)}
                      onKeyDown={handleTaskInputKeyDown}
                      disabled={addingTask}
                      className="flex-1 text-sm text-gray-900 bg-white border border-gray-200 rounded-lg px-3 py-2 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                    />
                    <button
                      type="button"
                      onClick={handleAddTask}
                      disabled={addingTask || !newTaskTitle.trim()}
                      className="px-3 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      Thêm
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">Chỉ người trực hoặc quản lý mới được sửa checklist.</p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

