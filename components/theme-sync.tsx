"use client";

import { useEffect } from "react";

export function ThemeSync({ theme }: { theme: string }) {
  useEffect(() => {
    const isDark = theme === "dark";
    document.documentElement.classList.toggle("dark", isDark);
    document.cookie = `theme=${theme};path=/;max-age=31536000;SameSite=Lax`;
  }, [theme]);

  return null;
}
