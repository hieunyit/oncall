"use client";

import { addDays, format, differenceInMinutes, isSameDay } from "date-fns";
import { vi } from "date-fns/locale";

interface ShiftBlock {
  id: string;
  assigneeName: string;
  assigneeId: string;
  policyName: string;
  startsAt: Date;
  endsAt: Date;
  confirmationStatus?: string | null;
  isMe: boolean;
  isOverride?: boolean;
  checklistTotal?: number;
  checklistDone?: number;
}

interface WeekTimelineProps {
  weekStart: Date;
  numDays: number;
  shifts: ShiftBlock[];
  currentUserId: string;
  highlightMe: boolean;
  onShiftClick?: (shift: ShiftBlock) => void;
}

const PALETTE = [
  { bg: "#ede9fe", border: "#7c3aed", text: "#4c1d95" },
  { bg: "#fce7f3", border: "#db2777", text: "#831843" },
  { bg: "#ffedd5", border: "#ea580c", text: "#7c2d12" },
  { bg: "#ccfbf1", border: "#0d9488", text: "#134e4a" },
  { bg: "#cffafe", border: "#0891b2", text: "#164e63" },
  { bg: "#d9f99d", border: "#65a30d", text: "#365314" },
  { bg: "#fee2e2", border: "#e11d48", text: "#881337" },
  { bg: "#e0e7ff", border: "#4338ca", text: "#1e1b4b" },
  { bg: "#fef9c3", border: "#ca8a04", text: "#713f12" },
  { bg: "#dcfce7", border: "#16a34a", text: "#14532d" },
];

export function getUserColor(userId: string) {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash * 31) + userId.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

export function WeekTimeline({
  weekStart,
  numDays,
  shifts,
  currentUserId,
  highlightMe,
  onShiftClick,
}: WeekTimelineProps) {
  const weekEnd = addDays(weekStart, numDays);
  const totalMinutes = numDays * 24 * 60;
  const today = new Date();

  const visible = shifts.filter((s) => s.startsAt < weekEnd && s.endsAt > weekStart);

  // Collect users in order of first appearance
  const seenUsers = new Set<string>();
  const userOrder: string[] = [];
  const userNames: Record<string, string> = {};
  for (const s of visible) {
    if (!seenUsers.has(s.assigneeId)) {
      seenUsers.add(s.assigneeId);
      userOrder.push(s.assigneeId);
      userNames[s.assigneeId] = s.assigneeName;
    }
  }

  const days = Array.from({ length: numDays }, (_, i) => addDays(weekStart, i));

  function barStyle(shift: ShiftBlock) {
    const clampedStart = shift.startsAt < weekStart ? weekStart : shift.startsAt;
    const clampedEnd = shift.endsAt > weekEnd ? weekEnd : shift.endsAt;
    const startMin = differenceInMinutes(clampedStart, weekStart);
    const durMin = differenceInMinutes(clampedEnd, clampedStart);
    return {
      left: `${(startMin / totalMinutes) * 100}%`,
      width: `${Math.max((durMin / totalMinutes) * 100, 0.5)}%`,
    };
  }

  if (userOrder.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-400">
        Không có ca trực nào trong khoảng thời gian này.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="flex border-b border-gray-200">
        <div className="w-36 shrink-0 border-r border-gray-200 bg-gray-50 py-2.5 px-3 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
          Người trực
        </div>
        <div className="flex-1 flex">
          {days.map((day, i) => {
            const isToday = isSameDay(day, today);
            const isWeekend = day.getDay() === 0 || day.getDay() === 6;
            return (
              <div
                key={i}
                style={{ width: `${100 / numDays}%` }}
                className={`py-2 text-center border-r last:border-r-0 border-gray-100 ${
                  isWeekend ? "bg-blue-50" : ""
                }`}
              >
                <div className="flex flex-col items-center gap-0.5">
                  <span className={`text-[10px] uppercase tracking-wide ${isWeekend ? "text-blue-400" : "text-gray-400"}`}>
                    {format(day, "EEE", { locale: vi })}
                  </span>
                  <span className={`text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full ${
                    isToday ? "bg-blue-600 text-white" : isWeekend ? "text-blue-500" : "text-gray-600"
                  }`}>
                    {format(day, "d")}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* User rows */}
      {userOrder.map((userId) => {
        const userShifts = visible.filter((s) => s.assigneeId === userId);
        const color = getUserColor(userId);
        const isMe = userId === currentUserId;
        const dimmed = highlightMe && !isMe;

        return (
          <div
            key={userId}
            className={`flex border-b last:border-b-0 border-gray-100 transition-opacity duration-200 ${dimmed ? "opacity-25" : ""}`}
          >
            {/* Name */}
            <div className="w-36 shrink-0 border-r border-gray-100 bg-gray-50 px-3 flex items-center min-h-[56px]">
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: color.border }}
                />
                <span
                  className={`text-xs truncate ${isMe ? "font-bold" : "font-medium text-gray-700"}`}
                  style={isMe ? { color: color.border } : {}}
                >
                  {userNames[userId]}
                </span>
              </div>
            </div>

            {/* Timeline area */}
            <div className="flex-1 relative min-h-[56px]">
              {/* Day dividers */}
              {days.map((day, i) => {
                const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                return (
                  <div
                    key={i}
                    className={`absolute top-0 bottom-0 border-r border-gray-100 ${isWeekend ? "bg-blue-50/30" : ""}`}
                    style={{ left: `${(i / numDays) * 100}%`, width: `${100 / numDays}%` }}
                  />
                );
              })}

              {/* Shift bars */}
              {userShifts.map((shift) => {
                const style = barStyle(shift);
                const barColor = shift.isOverride
                  ? { bg: "#fef3c7", border: "#d97706", text: "#78350f" }
                  : color;
                const statusDot =
                  shift.confirmationStatus === "CONFIRMED" ? "#22c55e" :
                  shift.confirmationStatus === "DECLINED" ? "#ef4444" :
                  shift.confirmationStatus === "PENDING" ? "#eab308" : null;

                return (
                  <div
                    key={shift.id}
                    onClick={() => onShiftClick?.(shift)}
                    style={{
                      left: style.left,
                      width: style.width,
                      backgroundColor: barColor.bg,
                      borderColor: barColor.border,
                      color: barColor.text,
                    }}
                    className="absolute top-2 bottom-2 rounded border cursor-pointer hover:brightness-95 px-1.5 flex items-center gap-1 overflow-hidden transition-all"
                    title={`${shift.assigneeName} · ${shift.policyName} · ${format(shift.startsAt, "HH:mm dd/MM")} – ${format(shift.endsAt, "HH:mm dd/MM")}`}
                  >
                    {statusDot && (
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: statusDot }} />
                    )}
                    <span className="text-[11px] font-medium truncate leading-tight">
                      {format(shift.startsAt, "HH:mm")}
                      {shift.checklistTotal && shift.checklistTotal > 0 ? (
                        <span className="ml-1 opacity-60 text-[10px]">✓{shift.checklistDone}/{shift.checklistTotal}</span>
                      ) : null}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
