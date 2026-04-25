"use client";

import { signOut } from "next-auth/react";
import type { Session } from "next-auth";

interface AppHeaderProps {
  user: Session["user"];
}

export function AppHeader({ user }: AppHeaderProps) {
  return (
    <header className="h-16 shrink-0 bg-white border-b border-gray-200 flex items-center justify-between px-6">
      <div />
      <div className="flex items-center gap-4">
        <span className="text-sm text-gray-600">{user?.name ?? user?.email}</span>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
        >
          Đăng xuất
        </button>
      </div>
    </header>
  );
}
