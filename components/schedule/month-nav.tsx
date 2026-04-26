"use client";

import { format, addMonths, subMonths } from "date-fns";
import { vi } from "date-fns/locale";
import { useRouter } from "next/navigation";

interface MonthNavProps {
  monthStart: Date;
}

export function MonthNav({ monthStart }: MonthNavProps) {
  const router = useRouter();

  function navigate(delta: number) {
    const target = delta > 0 ? addMonths(monthStart, 1) : subMonths(monthStart, 1);
    const param = format(target, "yyyy-MM");
    const url = new URL(window.location.href);
    url.searchParams.set("month", param);
    router.push(url.toString());
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => navigate(-1)}
        className="px-2 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"
      >
        ‹
      </button>
      <span className="text-sm font-medium text-gray-800 min-w-28 text-center">
        {format(monthStart, "MMMM yyyy", { locale: vi })}
      </span>
      <button
        onClick={() => navigate(1)}
        className="px-2 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"
      >
        ›
      </button>
      <button
        onClick={() => {
          const url = new URL(window.location.href);
          url.searchParams.set("month", format(new Date(), "yyyy-MM"));
          router.push(url.toString());
        }}
        className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-500"
      >
        Hôm nay
      </button>
    </div>
  );
}
