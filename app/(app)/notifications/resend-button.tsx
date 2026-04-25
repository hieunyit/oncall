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
      className="text-xs px-2 py-1 bg-blue-50 text-blue-700 rounded hover:bg-blue-100 disabled:opacity-50"
    >
      {loading ? "..." : "Gửi lại"}
    </button>
  );
}
