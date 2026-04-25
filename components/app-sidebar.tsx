"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: "⊞" },
  { href: "/schedule", label: "Lịch trực", icon: "📅" },
  { href: "/teams", label: "Nhóm", icon: "👥" },
  { href: "/policies", label: "Chính sách xoay vòng", icon: "🔄" },
  { href: "/swaps", label: "Yêu cầu đổi ca", icon: "↔️" },
  { href: "/notifications", label: "Thông báo", icon: "🔔" },
  { href: "/notifications", label: "Thông báo gửi đi", icon: "📬" },
  { href: "/users", label: "Người dùng", icon: "👤" },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 shrink-0 bg-white border-r border-gray-200 flex flex-col">
      <div className="h-16 flex items-center px-6 border-b border-gray-200">
        <span className="font-bold text-gray-900 text-lg">On-Call</span>
      </div>
      <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? "bg-blue-50 text-blue-700"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
