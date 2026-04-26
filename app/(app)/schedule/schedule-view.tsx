"use client";

import { useState, useEffect } from "react";
import { format, addDays, startOfWeek, addWeeks, subWeeks, isSameMonth } from "date-fns";
import { vi } from "date-fns/locale";
import { MonthCalendar } from "@/components/schedule/month-calendar";
import { MonthNav } from "@/components/schedule/month-nav";
import { WeekTimeline } from "@/components/schedule/week-timeline";
import { OverrideShiftModal } from "./override-shift-modal";

interface ShiftBlock {
  id: string;
  assigneeName: string;
  assigneeId: string;
  policyId: string;
  teamId: string;
  policyName: string;
  startsAt: Date;
  endsAt: Date;
  confirmationStatus?: string | null;
  confirmationToken?: string | null;
  isMe: boolean;
  isOverride?: boolean;
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
  const [weekStart, setWeekStart] = useState(() => {
    const today = new Date();
    return isSameMonth(monthStart, today)
      ? startOfWeek(today, { weekStartsOn: 1 })
      : startOfWeek(monthStart, { weekStartsOn: 1 });
  });
  const [overrideShift, setOverrideShift] = useState<ShiftBlock | null>(null);
  const [selectedShift, setSelectedShift] = useState<ShiftBlock | null>(null);

  const numDays = view === "2week" ? 14 : 7;

  function prevPeriod() {
    setWeekStart((ws) => subWeeks(ws, view === "2week" ? 2 : 1));
  }

  function nextPeriod() {
    setWeekStart((ws) => addWeeks(ws, view === "2week" ? 2 : 1));
  }

  function goToday() {
    setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }));
  }

  const weekEnd = addDays(weekStart, numDays - 1);
  const weekLabel = `${format(weekStart, "dd/MM")} – ${format(weekEnd, "dd/MM/yyyy")}`;

  return (
    <>
      {/* Header row */}
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
            Nổi bật ca của tôi
          </button>

          {/* Month nav (month view) or week nav (week/2week view) */}
          {view === "month" ? (
            <MonthNav monthStart={monthStart} />
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={prevPeriod}
                className="px-2 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"
              >
                ‹
              </button>
              <span className="text-sm font-medium text-gray-800 min-w-36 text-center">
                {weekLabel}
              </span>
              <button
                onClick={nextPeriod}
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
          isManager={isManager}
          onShiftClick={(shift) => setSelectedShift(shift)}
          onOverride={isManager ? setOverrideShift : undefined}
        />
      ) : (
        <WeekTimeline
          weekStart={weekStart}
          numDays={numDays}
          shifts={shifts}
          currentUserId={currentUserId}
          highlightMe={highlightMe}
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
        />
      )}
    </>
  );
}

function ShiftDetailModal({ shift, onClose }: { shift: ShiftBlock; onClose: () => void }) {
  const [tasks, setTasks] = useState<Array<{ id: string; title: string; isCompleted: boolean }>>([]);
  const [tasksLoaded, setTasksLoaded] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [addingTask, setAddingTask] = useState(false);

  useEffect(() => {
    fetch(`/api/shifts/${shift.id}/tasks`)
      .then((r) => r.json())
      .then((d) => {
        setTasks(d.data ?? []);
        setTasksLoaded(true);
      })
      .catch(() => setTasksLoaded(true));
  }, [shift.id]);

  const totalTasks = tasks.length;
  const doneTasks = tasks.filter((t) => t.isCompleted).length;
  const allDone = totalTasks > 0 && doneTasks === totalTasks;

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
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, isCompleted: !current } : t))
      );
    }
  }

  async function handleDeleteTask(taskId: string) {
    const res = await fetch(`/api/shifts/${shift.id}/tasks/${taskId}`, { method: "DELETE" });
    if (res.ok) {
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Chi tiết ca trực</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        {/* Shift info */}
        <div className="px-5 py-4 space-y-3 border-b border-gray-100">
          <div>
            <p className="text-xs text-gray-500">Người trực</p>
            <p className="font-semibold text-gray-900">{shift.assigneeName}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Chính sách</p>
            <p className="text-sm text-gray-700">{shift.policyName}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Thời gian</p>
            <p className="text-sm text-gray-700">
              {format(shift.startsAt, "HH:mm dd/MM/yyyy")} – {format(shift.endsAt, "HH:mm dd/MM/yyyy")}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {shift.confirmationStatus && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                shift.confirmationStatus === "CONFIRMED" ? "bg-green-100 text-green-700" :
                shift.confirmationStatus === "PENDING" ? "bg-yellow-100 text-yellow-700" :
                shift.confirmationStatus === "DECLINED" ? "bg-red-100 text-red-700" :
                "bg-gray-100 text-gray-500"
              }`}>
                {shift.confirmationStatus}
              </span>
            )}
            {shift.isOverride && (
              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700">override</span>
            )}
            {shift.checklistRequired && !allDone && totalTasks > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-orange-100 text-orange-700">
                Cần hoàn thành checklist
              </span>
            )}
          </div>
        </div>

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
                    <span className={`flex-1 text-sm text-gray-800 ${task.isCompleted ? "line-through text-gray-400" : ""}`}>
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
