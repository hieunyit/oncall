"use client";

import { useState } from "react";
import { addDays, format, isSameDay, isSameMonth, startOfDay, startOfMonth, startOfWeek, endOfMonth, endOfWeek } from "date-fns";
import { getUserColor } from "./week-timeline";

interface ShiftBlock {
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
  isMe: boolean;
  isOverride?: boolean;
  source?: string;
  checklistRequired?: boolean;
  checklistTotal?: number;
  checklistDone?: number;
}

interface MonthCalendarProps {
  monthStart: Date;
  shifts: ShiftBlock[];
  currentUserId: string;
  highlightMe?: boolean;
  selectedPersonId?: string | null;
  isManager?: boolean;
  onShiftClick?: (shift: ShiftBlock) => void;
  onOverride?: (shift: ShiftBlock) => void;
}

const DOW_LABELS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

export function MonthCalendar({
  monthStart,
  shifts,
  currentUserId,
  highlightMe,
  selectedPersonId,
  onShiftClick,
  onOverride,
}: MonthCalendarProps) {
  const today = new Date();
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());

  const gridStart = startOfWeek(startOfMonth(monthStart), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(monthStart), { weekStartsOn: 1 });

  const days: Date[] = [];
  let cur = gridStart;
  while (cur <= gridEnd) {
    days.push(cur);
    cur = addDays(cur, 1);
  }

  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  function toggleExpanded(dayKey: string) {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(dayKey)) next.delete(dayKey);
      else next.add(dayKey);
      return next;
    });
  }

  function getShiftsForDay(day: Date) {
    const dayStart = startOfDay(day);
    const dayEnd = addDays(dayStart, 1);
    return shifts.filter((s) => s.startsAt < dayEnd && s.endsAt > dayStart);
  }

  function hasCrossPolicyConflict(shift: ShiftBlock, dayShifts: ShiftBlock[]): boolean {
    return dayShifts.some(
      (other) =>
        other.id !== shift.id &&
        other.assigneeId === shift.assigneeId &&
        other.teamId === shift.teamId &&
        other.policyId !== shift.policyId &&
        other.startsAt < shift.endsAt &&
        other.endsAt > shift.startsAt
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Day of week headers */}
      <div className="grid grid-cols-7 border-b border-gray-200">
        {DOW_LABELS.map((label, i) => {
          const isWeekend = i >= 5;
          return (
            <div
              key={label}
              className={`py-2.5 text-center text-xs font-semibold tracking-wide uppercase ${
                isWeekend ? "bg-gray-50 text-gray-400" : "text-gray-500"
              }`}
            >
              {label}
            </div>
          );
        })}
      </div>

      {/* Weeks */}
      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7 border-b border-gray-100 last:border-b-0">
          {week.map((day, di) => {
            const isToday = isSameDay(day, today);
            const inMonth = isSameMonth(day, monthStart);
            const isWeekend = di >= 5;
            const dayShifts = getShiftsForDay(day);
            const dayKey = day.toISOString();
            const isExpanded = expandedDays.has(dayKey);
            const visibleShifts = isExpanded ? dayShifts : dayShifts.slice(0, 4);

            return (
              <div
                key={dayKey}
                className={`min-h-[96px] p-1.5 border-r last:border-r-0 border-gray-100 transition-colors ${
                  isWeekend ? "bg-blue-50/40" : ""
                } ${!inMonth ? "opacity-40" : ""}`}
              >
                {/* Date number */}
                <div className="flex justify-end items-start mb-1">
                  <span
                    className={`text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full ${
                      isToday
                        ? "bg-blue-600 text-white"
                        : isWeekend
                          ? "text-blue-400"
                          : "text-gray-500"
                    }`}
                  >
                    {format(day, "d")}
                  </span>
                </div>

                {/* Shift chips */}
                <div className="space-y-0.5">
                  {visibleShifts.map((shift) => {
                    const color = shift.isOverride
                      ? { bg: "#fef3c7", border: "#d97706", text: "#78350f", solid: "#f59e0b" }
                      : getUserColor(shift.assigneeId);
                    const isMe = shift.assigneeId === currentUserId;
                    const personDimmed = selectedPersonId && shift.assigneeId !== selectedPersonId;
                    const dimmed = (highlightMe && !isMe) || !!personDimmed;
                    const confirmed = shift.confirmationStatus === "CONFIRMED";
                    const declined = shift.confirmationStatus === "DECLINED";
                    const pending = shift.confirmationStatus === "PENDING";
                    const hasChecklist =
                      shift.checklistTotal !== undefined && shift.checklistTotal > 0;
                    const conflict = hasCrossPolicyConflict(shift, dayShifts);
                    // Only warn about incomplete checklist when the shift is active or starts within 2h
                    const shiftNear = shift.startsAt <= new Date(today.getTime() + 2 * 60 * 60 * 1000);
                    const checklistIncomplete =
                      shiftNear &&
                      shift.checklistRequired &&
                      (shift.checklistTotal === 0 || (shift.checklistDone ?? 0) < (shift.checklistTotal ?? 0));
                    const allChecklistDone = hasChecklist && shift.checklistDone === shift.checklistTotal;
                    const isSwap = shift.source === "SWAP";

                    return (
                      <div
                        key={shift.id}
                        onClick={() => onShiftClick?.(shift)}
                        onContextMenu={
                          onOverride
                            ? (e) => { e.preventDefault(); onOverride(shift); }
                            : undefined
                        }
                        style={{
                          backgroundColor: conflict ? "#dc2626" : color.solid,
                          opacity: dimmed ? 0.25 : 1,
                          outline: checklistIncomplete ? "2px solid #f97316" : undefined,
                          outlineOffset: "-1px",
                        }}
                        className={`rounded px-1.5 py-0.5 text-[11px] leading-tight cursor-pointer hover:brightness-110 flex items-center gap-1 transition-all text-white shadow-sm ${
                          isMe ? "font-semibold" : "font-medium"
                        }`}
                        title={
                          conflict
                            ? `⚠ Chồng chéo chính sách! ${shift.assigneeName} · ${shift.policyName} · ${format(shift.startsAt, "HH:mm")}–${format(shift.endsAt, "HH:mm")}`
                            : checklistIncomplete
                              ? `! Checklist chưa hoàn thành · ${shift.assigneeName} · ${format(shift.startsAt, "HH:mm")}–${format(shift.endsAt, "HH:mm")}`
                              : `${shift.assigneeName} · ${shift.policyName} · ${format(shift.startsAt, "HH:mm")}–${format(shift.endsAt, "HH:mm")}`
                        }
                      >
                        {conflict && <span className="shrink-0 text-[10px]">⚠</span>}
                        {!conflict && checklistIncomplete && <span className="shrink-0 text-[10px]">!</span>}
                        {!conflict && !checklistIncomplete && isSwap && <span className="shrink-0 text-[10px]">⇄</span>}
                        {!conflict && !checklistIncomplete && !isSwap && confirmed && <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-green-300" />}
                        {!conflict && !checklistIncomplete && !isSwap && declined && <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-red-300" />}
                        {!conflict && !checklistIncomplete && !isSwap && pending && <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-yellow-200" />}
                        <span className="truncate">{shift.assigneeName}</span>
                        {hasChecklist && (
                          <span className={`text-[9px] shrink-0 ml-auto ${allChecklistDone ? "text-green-300" : checklistIncomplete ? "text-orange-200 font-bold" : "opacity-70"}`}>
                            ✓{shift.checklistDone}/{shift.checklistTotal}
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {!isExpanded && dayShifts.length > 4 && (
                    <button
                      type="button"
                      onClick={() => toggleExpanded(dayKey)}
                      className="text-[10px] text-indigo-500 hover:text-indigo-700 pl-1 cursor-pointer w-full text-left"
                    >
                      +{dayShifts.length - 4} ca nữa
                    </button>
                  )}
                  {isExpanded && dayShifts.length > 4 && (
                    <button
                      type="button"
                      onClick={() => toggleExpanded(dayKey)}
                      className="text-[10px] text-indigo-400 hover:text-indigo-600 pl-1 cursor-pointer w-full text-left"
                    >
                      Thu gọn
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
