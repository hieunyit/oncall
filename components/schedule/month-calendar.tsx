"use client";

import { addDays, format, isSameDay, isSameMonth, startOfMonth, startOfWeek, endOfMonth, endOfWeek } from "date-fns";
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
  confirmationStatus?: string | null;
  isMe: boolean;
  isOverride?: boolean;
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

  function getShiftsForDay(day: Date) {
    return shifts.filter(
      (s) => isSameDay(s.startsAt, day) || (s.startsAt < day && s.endsAt > day)
    );
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

            // Coverage gap: in-month, non-weekend day with no shifts at all
            const isCoverageGap = inMonth && !isToday && dayShifts.length === 0;

            return (
              <div
                key={day.toISOString()}
                className={`min-h-[96px] p-1.5 border-r last:border-r-0 border-gray-100 transition-colors ${
                  isWeekend ? "bg-blue-50/40" : isCoverageGap ? "bg-red-50/60" : ""
                } ${!inMonth ? "opacity-40" : ""}`}
              >
                {/* Date number */}
                <div className="flex justify-between items-start mb-1">
                  <div className="w-4">
                    {isCoverageGap && (
                      <svg className="w-3 h-3 text-red-300 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                      </svg>
                    )}
                  </div>
                  <span
                    className={`text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full ${
                      isToday
                        ? "bg-blue-600 text-white"
                        : isWeekend
                          ? "text-blue-400"
                          : isCoverageGap
                            ? "text-red-400"
                            : "text-gray-500"
                    }`}
                  >
                    {format(day, "d")}
                  </span>
                </div>

                {/* Shift chips */}
                <div className="space-y-0.5">
                  {dayShifts.slice(0, 4).map((shift) => {
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
                    const checklistIncomplete =
                      shift.checklistRequired &&
                      (shift.checklistTotal === 0 || (shift.checklistDone ?? 0) < (shift.checklistTotal ?? 0));
                    const allChecklistDone = hasChecklist && shift.checklistDone === shift.checklistTotal;

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
                        {!conflict && !checklistIncomplete && confirmed && <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-green-300" />}
                        {!conflict && !checklistIncomplete && declined && <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-red-300" />}
                        {!conflict && !checklistIncomplete && pending && <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-yellow-200" />}
                        <span className="truncate">{shift.assigneeName}</span>
                        {hasChecklist && (
                          <span className={`text-[9px] shrink-0 ml-auto ${allChecklistDone ? "text-green-300" : checklistIncomplete ? "text-orange-200 font-bold" : "opacity-70"}`}>
                            ✓{shift.checklistDone}/{shift.checklistTotal}
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {dayShifts.length > 4 && (
                    <div className="text-[10px] text-gray-400 pl-1">
                      +{dayShifts.length - 4} ca nữa
                    </div>
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
