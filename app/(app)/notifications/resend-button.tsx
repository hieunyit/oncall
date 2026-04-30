"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ResendButton({ deliveryId }: { deliveryId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleResend() {
    setLoading(true);
    await fetch(`/api/notifications/${deliveryId}/resend`, {
      method: "POST",
      headers: {
        "Idempotency-Key": `resend-${deliveryId}-${Date.now()}`,
      },
    });
    router.refresh();
    setLoading(false);
  }

  return (
    <button
      onClick={handleResend}
      disabled={loading}
      className="inline-flex h-7 items-center rounded-md border border-indigo-200 bg-indigo-50 px-2.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading ? "Đang gửi..." : "Gửi lại"}
    </button>
  );
}
