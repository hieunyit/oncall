"use client";

import { useState, useEffect, useCallback } from "react";
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
  policyName: string;
  startsAt: Date;
  endsAt: Date;
  status?: string;
  confirmationStatus?: string | null;
  confirmationToken?: string | null;
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
  const [tasks, setTasks] = useState<Array<{ id: string; title: string; isCompleted: boolean }>>([]);
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

  const isMe = shift.assigneeId === currentUserId;
  const isPending = localConfirmStatus === "PENDING";
  const isActive = shift.status === "ACTIVE";
  const canRequestSwap = isMe && !isActive && shift.status !== "COMPLETED";

  useEffect(() => {
    fetch(`/api/shifts/${shift.id}/tasks`)
      .then((r) => r.json())
      .then((d) => { setTasks(d.data ?? []); setTasksLoaded(true); })
      .catch(() => setTasksLoaded(true));
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

  async function handleAddTask(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter" || !newTaskTitle.trim()) return;
    setAddingTask(true);
    const res = await fetch(`/api/shifts/${shift.id}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTaskTitle.trim() }),
    });
    if (res.ok) {
      const d = await res.json();
      setTasks((prev) => [...prev, d.data]);
      setNewTaskTitle("");
    }
    setAddingTask(false);
  }

  async function handleToggleTask(taskId: string, current: boolean) {
    const res = await fetch(`/api/shifts/${shift.id}/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isCompleted: !current }),
    });
    if (res.ok) {
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, isCompleted: !current } : t)));
    }
  }

  async function handleDeleteTask(taskId: string) {
    const res = await fetch(`/api/shifts/${shift.id}/tasks/${taskId}`, { method: "DELETE" });
    if (res.ok) setTasks((prev) => prev.filter((t) => t.id !== taskId));
  }

  const totalTasks = tasks.length;
  const doneTasks = tasks.filter((t) => t.isCompleted).length;
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
            <p className="text-xs text-gray-400 mb-0.5">Chính sách</p>
            <p className="text-sm text-gray-700">{shift.policyName}</p>
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
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-gray-700">Checklist công việc</h3>
            {tasksLoaded && totalTasks > 0 && (
              <div className="flex items-center gap-2">
                <span className={`text-xs font-semibold ${allDone ? "text-green-600" : "text-gray-500"}`}>
                  {doneTasks}/{totalTasks}
                </span>
                <div className="w-20 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${allDone ? "bg-green-500" : "bg-blue-500"}`}
                    style={{ width: `${totalTasks > 0 ? (doneTasks / totalTasks) * 100 : 0}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {!tasksLoaded ? (
            <p className="text-xs text-gray-400">Đang tải...</p>
          ) : (
            <>
              {totalTasks === 0 && (
                <p className="text-xs text-gray-400 mb-3">Chưa có mục nào. Nhập bên dưới để thêm.</p>
              )}
              <div className="space-y-1.5 mb-3">
                {tasks.map((task) => (
                  <div key={task.id} className="flex items-center gap-2.5 group py-0.5">
                    <input
                      type="checkbox"
                      checked={task.isCompleted}
                      onChange={() => handleToggleTask(task.id, task.isCompleted)}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 shrink-0"
                    />
                    <span className={`flex-1 text-sm ${task.isCompleted ? "line-through text-gray-400" : "text-gray-800"}`}>
                      {task.title}
                    </span>
                    <button
                      onClick={() => handleDeleteTask(task.id)}
                      className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 text-xs shrink-0"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <input
                type="text"
                placeholder="Thêm mục... (Enter để lưu)"
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                onKeyDown={handleAddTask}
                disabled={addingTask}
                className="w-full text-sm text-gray-900 bg-white border border-gray-200 rounded-lg px-3 py-2 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
