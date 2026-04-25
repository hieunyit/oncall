"use client";

import { addDays, format, isSameDay, startOfWeek } from "date-fns";
import { vi } from "date-fns/locale";
import Link from "next/link";

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
}

interface WeekCalendarProps {
  weekStart: Date;
  shifts: ShiftBlock[];
  currentUserId: string;
}

const STATUS_COLORS: Record<string, string> = {
  CONFIRMED: "bg-green-100 border-green-300 text-green-800",
  PENDING: "bg-yellow-100 border-yellow-300 text-yellow-800",
  DECLINED: "bg-red-100 border-red-300 text-red-800",
  EXPIRED: "bg-gray-100 border-gray-300 text-gray-500",
};

export function WeekCalendar({ weekStart, shifts, currentUserId }: WeekCalendarProps) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = new Date();

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-gray-200">
        {days.map((day) => {
          const isToday = isSameDay(day, today);
          return (
            <div
              key={day.toISOString()}
              className={`px-2 py-3 text-center text-sm border-r last:border-r-0 border-gray-100 ${
                isToday ? "bg-blue-50" : ""
              }`}
            >
              <p className={`font-medium ${isToday ? "text-blue-700" : "text-gray-600"}`}>
                {format(day, "EEE", { locale: vi })}
              </p>
              <p
                className={`text-lg font-bold mt-0.5 ${
                  isToday
                    ? "w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center mx-auto"
                    : "text-gray-900"
                }`}
              >
                {format(day, "d")}
              </p>
            </div>
          );
        })}
      </div>

      {/* Shift rows */}
      <div className="grid grid-cols-7 min-h-32">
        {days.map((day) => {
          const dayShifts = shifts.filter(
            (s) =>
              isSameDay(s.startsAt, day) ||
              (s.startsAt <= day && s.endsAt > day)
          );

          return (
            <div
              key={day.toISOString()}
              className="p-1.5 border-r last:border-r-0 border-gray-100 space-y-1 min-h-[80px]"
            >
              {dayShifts.map((shift) => {
                const colorClass =
                  STATUS_COLORS[shift.confirmationStatus ?? ""] ??
                  (shift.isMe ? "bg-blue-100 border-blue-300 text-blue-800" : "bg-gray-100 border-gray-300 text-gray-700");

                return (
                  <div
                    key={shift.id}
                    className={`rounded-md border px-1.5 py-1 text-xs leading-tight ${colorClass} ${
                      shift.isMe ? "font-medium" : ""
                    }`}
                  >
                    <p className="truncate">{shift.policyName}</p>
                    <p className="truncate opacity-75">{shift.assigneeName}</p>
                    {shift.isMe && shift.confirmationStatus === "PENDING" && shift.confirmationToken && (
                      <Link
                        href={`/confirm/${shift.confirmationToken}`}
                        className="mt-0.5 inline-block underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Xác nhận
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
