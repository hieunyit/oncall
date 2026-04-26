"use client";

import { addDays, format, isSameDay, isSameMonth, startOfMonth, startOfWeek, endOfMonth, endOfWeek } from "date-fns";
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

interface MonthCalendarProps {
  monthStart: Date;
  shifts: ShiftBlock[];
  currentUserId: string;
  isManager?: boolean;
  onShiftClick?: (shift: ShiftBlock) => void;
  onOverride?: (shift: ShiftBlock) => void;
}

const STATUS_COLORS: Record<string, string> = {
  CONFIRMED: "bg-green-100 border-green-300 text-green-800",
  PENDING: "bg-yellow-100 border-yellow-300 text-yellow-800",
  DECLINED: "bg-red-100 border-red-300 text-red-800",
  EXPIRED: "bg-gray-100 border-gray-300 text-gray-500",
};

const DOW_LABELS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

export function MonthCalendar({
  monthStart,
  shifts,
  currentUserId,
  isManager,
  onShiftClick,
  onOverride,
}: MonthCalendarProps) {
  const today = new Date();

  // Build grid: start from Monday of first week, end on Sunday of last week
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
            const isWeekend = di >= 5; // Sat(index 5), Sun(index 6)
            const dayShifts = getShiftsForDay(day);

            return (
              <div
                key={day.toISOString()}
                className={`min-h-[100px] p-1.5 border-r last:border-r-0 border-gray-100 ${
                  isWeekend ? "bg-blue-50/40" : ""
                } ${!inMonth ? "opacity-40" : ""}`}
              >
                {/* Date number */}
                <div className="flex justify-end mb-1">
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
                  {dayShifts.slice(0, 3).map((shift) => {
                    const colorClass = shift.isOverride
                      ? "bg-amber-100 border-amber-300 text-amber-800"
                      : STATUS_COLORS[shift.confirmationStatus ?? ""] ??
                        (shift.isMe
                          ? "bg-blue-100 border-blue-300 text-blue-800"
                          : "bg-gray-100 border-gray-300 text-gray-700");

                    const hasChecklist =
                      shift.checklistTotal !== undefined && shift.checklistTotal > 0;

                    return (
                      <div
                        key={shift.id}
                        onClick={() => onShiftClick?.(shift)}
                        className={`rounded border px-1 py-0.5 text-[11px] leading-tight truncate cursor-pointer hover:opacity-80 ${colorClass} ${shift.isMe ? "font-semibold" : ""}`}
                        title={`${shift.assigneeName} • ${shift.policyName} • ${format(shift.startsAt, "HH:mm")}–${format(shift.endsAt, "HH:mm")}`}
                      >
                        <span className="truncate block">
                          {format(shift.startsAt, "HH:mm")} {shift.assigneeName}
                        </span>
                        {hasChecklist && (
                          <span className="opacity-60 text-[10px]">
                            ✓ {shift.checklistDone}/{shift.checklistTotal}
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {dayShifts.length > 3 && (
                    <div className="text-[10px] text-gray-400 pl-1">
                      +{dayShifts.length - 3} ca nữa
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
