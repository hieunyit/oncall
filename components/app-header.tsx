"use client";

import { signOut } from "next-auth/react";
import Link from "next/link";
import type { Session } from "next-auth";
import { ThemeToggle } from "@/components/theme-toggle";

interface AppHeaderProps {
  user: Session["user"];
  pageTitle?: string;
}

export function AppHeader({ user, pageTitle }: AppHeaderProps) {
  const displayName = (user as { fullName?: string })?.fullName ?? user?.name ?? user?.email ?? "Người dùng";
  const initials = displayName.split(" ").map((w: string) => w[0]).slice(-2).join("").toUpperCase();

  return (
    <header className="h-14 shrink-0 bg-white border-b border-gray-100 flex items-center justify-between px-6">
      <div className="text-sm font-medium text-gray-500">{pageTitle ?? ""}</div>

      <div className="flex items-center gap-3">
        <ThemeToggle />

        <div className="w-px h-5 bg-gray-200" />

        <Link
          href="/profile"
          className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors group"
        >
          <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-semibold text-indigo-700 shrink-0">
            {initials}
          </div>
          <span className="text-sm font-medium text-gray-700 group-hover:text-gray-900 max-w-[140px] truncate">
            {displayName}
          </span>
        </Link>

        <div className="w-px h-5 bg-gray-200" />

        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-red-600 transition-colors px-2 py-1.5 rounded-lg hover:bg-red-50"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/>
          </svg>
          Đăng xuất
        </button>
      </div>
    </header>
  );
}
