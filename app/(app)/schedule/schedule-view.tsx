"use client";

import { useState } from "react";
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
      />

      <div className="flex flex-wrap gap-3 text-xs text-gray-500">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-green-200 inline-block" /> Đã xác nhận</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-yellow-200 inline-block" /> Chờ xác nhận</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-blue-200 inline-block" /> Ca của tôi</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-200 inline-block" /> Từ chối</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-200 inline-block" /> Override</span>
      </div>

      {overrideShift && (
        <OverrideShiftModal
          shift={overrideShift}
          teamMembers={teamMembers}
          onClose={() => setOverrideShift(null)}
        />
      )}
    </>
  );
}
