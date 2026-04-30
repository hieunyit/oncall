"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { format, addDays, startOfWeek, addWeeks, subWeeks, isSameMonth, differenceInMinutes } from "date-fns";
import { vi } from "date-fns/locale";
import { useRouter } from "next/navigation";
import { MonthCalendar } from "@/components/schedule/month-calendar";
import { MonthNav } from "@/components/schedule/month-nav";
import { WeekTimeline } from "@/components/schedule/week-timeline";
import { OverrideShiftModal } from "./override-shift-modal";

export interface ShiftBlock {
  id: string;
  assigneeName: string;
  assigneeId: string;
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
}

interface TeamMember {
  id: string;
  fullName: string;
}

interface Team {
  id: string;
  name: string;
}

type ViewMode = "week" | "2week" | "month";

interface Props {
  monthStart: Date;
  shifts: ShiftBlock[];
  currentUserId: string;
  isManager: boolean;
  teamMembers: TeamMember[];
  myTeams: Team[];
  teamId?: string;
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

export function ScheduleView({
  monthStart,
  shifts,
  currentUserId,
  isManager,
  teamMembers,
  myTeams,
  teamId,
}: Props) {
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
  const onCallNow = shifts.some((s) => s.isMe && s.startsAt <= now && s.endsAt > now);
  const upcomingCount = shifts.filter((s) => s.isMe && s.startsAt >= now && s.startsAt <= weekFromNow).length;
  const pendingCount = shifts.filter((s) => s.isMe && s.confirmationStatus === "PENDING").length;
  const openDayDetails = useCallback((day: Date, dayShifts: ShiftBlock[]) => {
    const sorted = [...dayShifts].sort(
      (a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.endsAt.getTime() - b.endsAt.getTime()
    );
    setSelectedDay({ date: day, shifts: sorted });
  }, []);

  const weekEnd = addDays(weekStart, numDays - 1);
  const weekLabel = `${format(weekStart, "dd/MM")} – ${format(weekEnd, "dd/MM/yyyy")}`;

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
                const url = new URL(window.location.href);
                if (e.target.value) url.searchParams.set("teamId", e.target.value);
                else url.searchParams.delete("teamId");
                window.location.href = url.toString();
              }}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700"
            >
              <option value="">Tất cả nhóm</option>
              {myTeams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
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
                          {shift.policyName}
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

          {shift.notes && (
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Ghi chú</p>
              <p className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2 leading-relaxed">{shift.notes}</p>
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
                    Bat buoc
                  </span>
                ) : (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">
                    Tuy chon
                  </span>
                )}
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                    allDone ? "bg-green-100 text-green-700" : totalTasks === 0 ? "bg-gray-100 text-gray-600" : "bg-blue-100 text-blue-700"
                  }`}
                >
                  {totalTasks === 0 ? "Chua co muc" : allDone ? "Hoan tat" : `${doneTasks}/${totalTasks}`}
                </span>
              </div>
            </div>

            {tasksLoaded && totalTasks > 0 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] text-gray-500">
                  <span>Tien do</span>
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
                Checklist chi mo tu 2 gio truoc khi ca bat dau.
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
                      Chua xong ({openTasks.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setTaskTab("done")}
                      className={`px-2.5 py-1 text-xs font-medium ${
                        taskTab === "done" ? "bg-indigo-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      Da xong ({doneTasksList.length})
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
                        Hoan tat tat ca
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleMany(false)}
                        disabled={bulkUpdating || doneTasksList.length === 0}
                        className="text-[11px] px-2 py-1 rounded border border-gray-200 text-gray-600 bg-white hover:bg-gray-50 disabled:opacity-50"
                      >
                        Mo lai tat ca
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
                                      Luu
                                    </button>
                                    <button
                                      type="button"
                                      onClick={cancelEditingTask}
                                      className="text-[11px] px-2 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50"
                                    >
                                      Huy
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <p className={`text-sm leading-relaxed ${task.isCompleted ? "text-gray-500 line-through" : "text-gray-800"}`}>
                                    {task.title}
                                  </p>
                                  {task.isCompleted && completedAt && (
                                    <p className="text-[11px] text-green-700 mt-0.5">Hoan thanh luc {completedAt}</p>
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
                                  Sua
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteTask(task.id)}
                                  disabled={deletingTaskId === task.id}
                                  className="text-[11px] px-1.5 py-0.5 rounded border border-red-200 text-red-500 hover:bg-red-50 disabled:opacity-50"
                                >
                                  Xoa
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
                      Them
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
