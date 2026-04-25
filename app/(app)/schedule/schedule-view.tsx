"use client";

import { useState, useEffect } from "react";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { WeekCalendar } from "@/components/schedule/week-calendar";
import { WeekNav } from "@/components/schedule/week-nav";
import { OverrideShiftModal } from "./override-shift-modal";

interface ShiftBlock {
  id: string;
  assigneeName: string;
  assigneeId: string;
  policyName: string;
  startsAt: Date;
  endsAt: Date;
  confirmationStatus?: string | null;
  confirmationToken?: string | null;
  isMe: boolean;
  isOverride?: boolean;
}

interface TeamMember {
  id: string;
  fullName: string;
}

interface Team {
  id: string;
  name: string;
}

interface Props {
  weekStart: Date;
  shifts: ShiftBlock[];
  currentUserId: string;
  isManager: boolean;
  teamMembers: TeamMember[];
  myTeams: Team[];
  teamId?: string;
}

function DayShiftItem({ shift, onClick }: { shift: ShiftBlock; onClick: () => void }) {
  return (
    <div
      className="px-5 py-3 hover:bg-gray-50 cursor-pointer"
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-gray-900 truncate">{shift.assigneeName}</p>
          <p className="text-xs text-gray-500 mt-0.5">{shift.policyName}</p>
          <p className="text-xs text-gray-600 mt-1">
            {format(shift.startsAt, "HH:mm")} – {format(shift.endsAt, "HH:mm")}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {shift.confirmationStatus && (
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
              shift.confirmationStatus === "CONFIRMED" ? "bg-green-100 text-green-700" :
              shift.confirmationStatus === "PENDING" ? "bg-yellow-100 text-yellow-700" :
              shift.confirmationStatus === "DECLINED" ? "bg-red-100 text-red-700" :
              "bg-gray-100 text-gray-500"
            }`}>
              {shift.confirmationStatus}
            </span>
          )}
          {shift.isOverride && (
            <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-amber-100 text-amber-700">
              override
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function ScheduleView({
  weekStart,
  shifts,
  currentUserId,
  isManager,
  teamMembers,
  myTeams,
  teamId,
}: Props) {
  const [overrideShift, setOverrideShift] = useState<ShiftBlock | null>(null);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [selectedDayShifts, setSelectedDayShifts] = useState<ShiftBlock[]>([]);
  const [selectedShift, setSelectedShift] = useState<ShiftBlock | null>(null);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900">Lịch trực</h1>
        <div className="flex items-center gap-3">
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
          <WeekNav weekStart={weekStart} />
        </div>
      </div>

      <WeekCalendar
        weekStart={weekStart}
        shifts={shifts}
        currentUserId={currentUserId}
        isManager={isManager}
        teamMembers={teamMembers}
        onOverride={isManager ? setOverrideShift : undefined}
        onDayClick={(day, dayShifts) => {
          setSelectedDay(day);
          setSelectedDayShifts(dayShifts);
          setSelectedShift(null);
        }}
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1 py-2.5 bg-gray-50 rounded-lg border border-gray-100 text-xs text-gray-500">
        <span className="flex items-center gap-1.5 font-medium text-gray-400 uppercase tracking-wide text-[10px]">Chú thích:</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-green-300 border border-green-400 inline-block shrink-0" /> Đã xác nhận</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-yellow-200 border border-yellow-300 inline-block shrink-0" /> Chờ xác nhận</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-blue-200 border border-blue-300 inline-block shrink-0" /> Ca của tôi</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-200 border border-red-300 inline-block shrink-0" /> Từ chối</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-200 border border-amber-300 inline-block shrink-0" /> Override</span>
      </div>

      {overrideShift && (
        <OverrideShiftModal
          shift={overrideShift}
          teamMembers={teamMembers}
          onClose={() => setOverrideShift(null)}
        />
      )}

      {selectedDay && (
        <div
          className="fixed inset-0 bg-black/30 z-40 flex justify-end"
          onClick={() => setSelectedDay(null)}
        >
          <div
            className="bg-white w-full max-w-sm h-full overflow-y-auto shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">
                {format(selectedDay, "EEEE, dd/MM/yyyy", { locale: vi })}
              </h2>
              <button
                onClick={() => setSelectedDay(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
            {selectedDayShifts.length === 0 ? (
              <p className="px-5 py-8 text-center text-gray-400 text-sm">Không có ca trực.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {selectedDayShifts.map((shift) => (
                  <DayShiftItem
                    key={shift.id}
                    shift={shift}
                    onClick={() => setSelectedShift(shift)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
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
        className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Chi tiết ca trực</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
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
          <div className="flex gap-2">
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
              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700">
                override
              </span>
            )}
          </div>
        </div>
        <div className="px-5 py-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Checklist</h3>
          {!tasksLoaded ? (
            <p className="text-xs text-gray-400">Đang tải...</p>
          ) : (
            <>
              <div className="space-y-2 mb-3">
                {tasks.map((task) => (
                  <div key={task.id} className="flex items-center gap-2 group">
                    <input
                      type="checkbox"
                      checked={task.isCompleted}
                      onChange={() => handleToggleTask(task.id, task.isCompleted)}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600"
                    />
                    <span className={`flex-1 text-sm ${task.isCompleted ? "line-through text-gray-400" : "text-gray-700"}`}>
                      {task.title}
                    </span>
                    <button
                      onClick={() => handleDeleteTask(task.id)}
                      className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 text-xs"
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
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
