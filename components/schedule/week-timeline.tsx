"use client";

import { addDays, format, differenceInMinutes, isSameDay } from "date-fns";
import { vi } from "date-fns/locale";

interface ShiftBlock {
  id: string;
  assigneeName: string;
  assigneeId: string;
  policyId: string;
  teamId: string;
  policyName: string;
  startsAt: Date;
  endsAt: Date;
  source?: string;
  confirmationStatus?: string | null;
  isMe: boolean;
  isOverride?: boolean;
  checklistRequired?: boolean;
  checklistTotal?: number;
  checklistDone?: number;
}

interface WeekTimelineProps {
  weekStart: Date;
  numDays: number;
  shifts: ShiftBlock[];
  currentUserId: string;
  highlightMe: boolean;
  selectedPersonId?: string | null;
  onDayClick?: (day: Date, shifts: ShiftBlock[]) => void;
  onShiftClick?: (shift: ShiftBlock) => void;
}

const PALETTE = [
  { bg: "#ede9fe", border: "#7c3aed", text: "#4c1d95", solid: "#7c3aed" },
  { bg: "#fce7f3", border: "#db2777", text: "#831843", solid: "#db2777" },
  { bg: "#ffedd5", border: "#ea580c", text: "#7c2d12", solid: "#ea580c" },
  { bg: "#ccfbf1", border: "#0d9488", text: "#134e4a", solid: "#0d9488" },
  { bg: "#cffafe", border: "#0891b2", text: "#164e63", solid: "#0891b2" },
  { bg: "#d9f99d", border: "#65a30d", text: "#365314", solid: "#65a30d" },
  { bg: "#fee2e2", border: "#e11d48", text: "#881337", solid: "#e11d48" },
  { bg: "#e0e7ff", border: "#4338ca", text: "#1e1b4b", solid: "#4338ca" },
  { bg: "#fef9c3", border: "#ca8a04", text: "#713f12", solid: "#ca8a04" },
  { bg: "#dcfce7", border: "#16a34a", text: "#14532d", solid: "#16a34a" },
];

export function getUserColor(userId: string) {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash * 31) + userId.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Hour marks to show per day based on view width
function getHourMarks(numDays: number): number[] {
  if (numDays <= 7) return [0, 6, 12, 18];   // every 6h for week view
  return [0, 12];                              // every 12h for 2-week view
}

export function WeekTimeline({
  weekStart,
  numDays,
  shifts,
  currentUserId,
  highlightMe,
  selectedPersonId,
  onDayClick,
  onShiftClick,
}: WeekTimelineProps) {
  const weekEnd = addDays(weekStart, numDays);
  const totalMinutes = numDays * 24 * 60;
  const now = new Date();

  const visible = shifts.filter((s) => s.startsAt < weekEnd && s.endsAt > weekStart);

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

  function hasCrossPolicyConflict(shift: ShiftBlock): boolean {
    return visible.some(
      (other) =>
        other.id !== shift.id &&
        other.assigneeId === shift.assigneeId &&
        other.teamId === shift.teamId &&
        other.policyId !== shift.policyId &&
        other.startsAt < shift.endsAt &&
        other.endsAt > shift.startsAt
    );
  }

  const days = Array.from({ length: numDays }, (_, i) => addDays(weekStart, i));
  const hourMarks = getHourMarks(numDays);

  // Current time indicator position (% from left)
  const nowInRange = now >= weekStart && now < weekEnd;
  const nowPct = nowInRange
    ? (differenceInMinutes(now, weekStart) / totalMinutes) * 100
    : null;

  function barStyle(shift: ShiftBlock) {
    const clampedStart = shift.startsAt < weekStart ? weekStart : shift.startsAt;
    const clampedEnd = shift.endsAt > weekEnd ? weekEnd : shift.endsAt;
    const startMin = differenceInMinutes(clampedStart, weekStart);
    const durMin = differenceInMinutes(clampedEnd, clampedStart);
    return {
      left: `${(startMin / totalMinutes) * 100}%`,
      width: `${Math.max((durMin / totalMinutes) * 100, 0.3)}%`,
    };
  }

  // Build all hour-mark positions (as % of total width)
  const hourMarkPositions: { pct: number; label: string; isDayBoundary: boolean }[] = [];
  for (let d = 0; d < numDays; d++) {
    for (const h of hourMarks) {
      const minFromStart = d * 24 * 60 + h * 60;
      const pct = (minFromStart / totalMinutes) * 100;
      const isDayBoundary = h === 0;
      const label = h === 0 ? format(addDays(weekStart, d), "d/M") : `${String(h).padStart(2, "0")}:00`;
      hourMarkPositions.push({ pct, label, isDayBoundary });
    }
  }

  if (userOrder.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-400">
        Không có ca trực nào trong khoảng thời gian này.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden select-none">
      {/* Header: day columns + hour sub-labels */}
      <div className="flex border-b border-gray-200">
        <div className="w-36 shrink-0 border-r border-gray-200 bg-gray-50" />
        <div className="flex-1 relative">
          {/* Day header row */}
          <div className="flex">
            {days.map((day, i) => {
              const isToday = isSameDay(day, now);
              const isWeekend = day.getDay() === 0 || day.getDay() === 6;
              const dayShifts = visible.filter(
                (s) => isSameDay(s.startsAt, day) || (s.startsAt <= day && s.endsAt > day)
              );
              return (
                <div
                  key={i}
                  onClick={() => onDayClick?.(day, dayShifts)}
                  style={{ width: `${100 / numDays}%` }}
                  className={`py-2 text-center border-r last:border-r-0 border-gray-100 ${isWeekend ? "bg-blue-50" : ""} ${onDayClick ? "cursor-pointer hover:bg-indigo-50/50" : ""}`}
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

          {/* Hour sub-labels row */}
          <div className="relative h-5 border-t border-gray-100 bg-gray-50/60">
            {hourMarkPositions.map(({ pct, label, isDayBoundary }, idx) => (
              <span
                key={idx}
                style={{ left: `${pct}%` }}
                className={`absolute top-0.5 -translate-x-1/2 text-[9px] tabular-nums ${
                  isDayBoundary ? "hidden" : "text-gray-400"
                }`}
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* User rows */}
      {userOrder.map((userId) => {
        const userShifts = visible.filter((s) => s.assigneeId === userId);
        const color = getUserColor(userId);
        const isMe = userId === currentUserId;
        const dimmed = (highlightMe && !isMe) || (!!selectedPersonId && userId !== selectedPersonId);

        return (
          <div
            key={userId}
            className={`flex border-b last:border-b-0 border-gray-100 transition-opacity duration-200 ${dimmed ? "opacity-20" : ""}`}
          >
            {/* Avatar + name */}
            <div className="w-36 shrink-0 border-r border-gray-100 bg-gray-50 px-3 flex items-center min-h-[56px]">
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-[11px] font-bold text-white leading-none"
                  style={{ backgroundColor: color.solid }}
                >
                  {initials(userNames[userId])}
                </div>
                <span
                  className={`text-xs truncate ${isMe ? "font-bold" : "font-medium text-gray-700"}`}
                  style={isMe ? { color: color.solid } : {}}
                >
                  {userNames[userId]}
                </span>
              </div>
            </div>

            {/* Timeline area */}
            <div className="flex-1 relative min-h-[56px]">
              {/* Hour grid lines */}
              {hourMarkPositions.map(({ pct, isDayBoundary }, idx) => (
                <div
                  key={idx}
                  className={`absolute top-0 bottom-0 ${isDayBoundary ? "border-r border-gray-200" : "border-r border-gray-100/70"}`}
                  style={{ left: `${pct}%` }}
                />
              ))}

              {/* Weekend backgrounds */}
              {days.map((day, i) => {
                const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                return isWeekend ? (
                  <div
                    key={i}
                    className="absolute top-0 bottom-0 bg-blue-50/40"
                    style={{ left: `${(i / numDays) * 100}%`, width: `${100 / numDays}%` }}
                  />
                ) : null;
              })}

              {/* Current time line */}
              {nowPct !== null && (
                <div
                  className="absolute top-0 bottom-0 w-px bg-red-500 z-10"
                  style={{ left: `${nowPct}%` }}
                >
                  <div className="absolute -top-0 -translate-x-1/2 w-2 h-2 rounded-full bg-red-500" />
                </div>
              )}

              {/* Shift bars */}
              {userShifts.map((shift) => {
                const style = barStyle(shift);
                const conflict = hasCrossPolicyConflict(shift);
                const barColor = conflict
                  ? { solid: "#dc2626" }
                  : shift.isOverride
                    ? { solid: "#f59e0b" }
                    : color;
                const confirmed = shift.confirmationStatus === "CONFIRMED";
                const declined = shift.confirmationStatus === "DECLINED";
                const pending = shift.confirmationStatus === "PENDING";
                const isSwap = shift.source === "SWAP";
                const checklistIncomplete =
                  shift.checklistRequired &&
                  (shift.checklistTotal === 0 || (shift.checklistDone ?? 0) < (shift.checklistTotal ?? 0));
                const allChecklistDone =
                  (shift.checklistTotal ?? 0) > 0 &&
                  shift.checklistDone === shift.checklistTotal;

                return (
                  <div
                    key={shift.id}
                    onClick={() => onShiftClick?.(shift)}
                    style={{
                      left: style.left,
                      width: style.width,
                      backgroundColor: barColor.solid,
                      outline: checklistIncomplete ? "2px solid #f97316" : undefined,
                      outlineOffset: "-2px",
                    }}
                    className="absolute top-1.5 bottom-1.5 rounded cursor-pointer hover:brightness-110 px-2 flex items-center gap-1.5 overflow-hidden transition-all z-20 shadow-sm"
                    title={
                      conflict
                        ? `⚠ Chồng chéo chính sách! ${shift.policyName} · ${format(shift.startsAt, "HH:mm dd/MM")} – ${format(shift.endsAt, "HH:mm dd/MM")}`
                        : checklistIncomplete
                          ? `! Checklist chưa hoàn thành · ${shift.assigneeName} · ${shift.policyName} · ${format(shift.startsAt, "HH:mm dd/MM")} – ${format(shift.endsAt, "HH:mm dd/MM")}`
                          : `${shift.assigneeName} · ${shift.policyName}${isSwap ? " · Đổi ca" : ""} · ${format(shift.startsAt, "HH:mm dd/MM")} – ${format(shift.endsAt, "HH:mm dd/MM")}`
                    }
                  >
                    {conflict && <span className="shrink-0 text-[11px]">⚠</span>}
                    {!conflict && checklistIncomplete && <span className="shrink-0 text-[11px]">!</span>}
                    {!conflict && !checklistIncomplete && isSwap && <span className="shrink-0 text-[11px]">⇄</span>}
                    <span className="text-[11px] font-semibold text-white truncate leading-tight flex-1 flex items-center gap-1 min-w-0">
                      <span className="truncate">{shift.policyName}</span>
                      <span className="opacity-70 shrink-0 hidden sm:inline">
                        {format(shift.startsAt, "HH:mm")}
                      </span>
                    </span>
                    {!conflict && (
                      <span className="shrink-0 flex items-center gap-0.5">
                        {confirmed && <span className="w-1.5 h-1.5 rounded-full bg-green-300" />}
                        {pending && <span className="w-1.5 h-1.5 rounded-full bg-yellow-200" />}
                        {declined && <span className="w-1.5 h-1.5 rounded-full bg-red-300" />}
                        {(shift.checklistTotal ?? 0) > 0 ? (
                          <span className={`text-[9px] ml-0.5 ${allChecklistDone ? "text-green-300" : checklistIncomplete ? "text-orange-200 font-bold" : "text-white/70"}`}>
                            ✓{shift.checklistDone}/{shift.checklistTotal}
                          </span>
                        ) : null}
                      </span>
                    )}
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
