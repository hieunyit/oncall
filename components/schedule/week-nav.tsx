"use client";

import { addWeeks, subWeeks, format } from "date-fns";
import { vi } from "date-fns/locale";
import { useRouter } from "next/navigation";

interface WeekNavProps {
  weekStart: Date;
}

export function WeekNav({ weekStart }: WeekNavProps) {
  const router = useRouter();

  function navigate(direction: "prev" | "next") {
    const newWeek = direction === "prev" ? subWeeks(weekStart, 1) : addWeeks(weekStart, 1);
    router.push(`/schedule?week=${newWeek.toISOString().slice(0, 10)}`);
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => navigate("prev")}
        className="p-2 rounded-lg hover:bg-gray-100 text-gray-600"
        aria-label="Tuần trước"
      >
        ‹
      </button>
      <span className="text-sm font-medium text-gray-700 min-w-40 text-center">
        {format(weekStart, "dd/MM", { locale: vi })} –{" "}
        {format(addWeeks(weekStart, 1), "dd/MM/yyyy", { locale: vi })}
      </span>
      <button
        onClick={() => navigate("next")}
        className="p-2 rounded-lg hover:bg-gray-100 text-gray-600"
        aria-label="Tuần sau"
      >
        ›
      </button>
    </div>
  );
}
