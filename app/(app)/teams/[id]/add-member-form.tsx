"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface User {
  id: string;
  fullName: string;
  email: string;
}

interface Props {
  teamId: string;
  availableUsers: User[];
  activePolicyIds: string[];
}

const RESCHEDULE_SKIP_CODES = new Set(["NO_PUBLISHED_BATCH", "BATCH_EXPIRED", "POLICY_INACTIVE"]);
type RescheduleOutcome = "ok" | "skipped" | "queue_degraded" | "error";
type AddMemberPayload = {
  data?: {
    telegramNotice?: {
      status?: "sent" | "failed" | "skipped_no_user" | "skipped_no_telegram";
      error?: string;
    };
  };
};

export function AddMemberForm({ teamId, availableUsers, activePolicyIds }: Props) {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<"MEMBER" | "MANAGER">("MEMBER");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function reschedulePolicy(policyId: string): Promise<RescheduleOutcome> {
    try {
      const res = await fetch(`/api/policies/${policyId}/reschedule-from-now`, {
        method: "POST",
      });
      const payload = (await res.json().catch(() => ({}))) as {
        code?: string;
        data?: { remindersScheduled?: boolean };
        remindersScheduled?: boolean;
      };
      if (!res.ok) {
        if (typeof payload.code === "string" && RESCHEDULE_SKIP_CODES.has(payload.code)) {
          return "skipped";
        }
        return "error";
      }
      const remindersScheduled =
        payload.data?.remindersScheduled ?? payload.remindersScheduled ?? true;
      if (!remindersScheduled) return "queue_degraded";
      return "ok";
    } catch {
      return "error";
    }
  }

  async function handleAdd() {
    if (!userId) return;
    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch(`/api/teams/${teamId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role }),
      });
      const createdPayload = (await res.json().catch(() => ({}))) as AddMemberPayload & {
        error?: string;
      };

      if (!res.ok) {
        setError(createdPayload.error ?? "Không thể thêm thành viên");
        return;
      }

      const outcomes =
        activePolicyIds.length > 0
          ? await Promise.all(activePolicyIds.map((policyId) => reschedulePolicy(policyId)))
          : [];
      const failedCount = outcomes.filter((outcome) => outcome === "error").length;
      const queueDegradedCount = outcomes.filter((outcome) => outcome === "queue_degraded").length;
      const teamNotice = createdPayload.data?.telegramNotice;
      const notices: string[] = [];

      setUserId("");
      if (failedCount > 0) {
        notices.push(
          `Đã thêm thành viên, nhưng ${failedCount}/${activePolicyIds.length} chính sách chưa cập nhật được lịch. Vui lòng bấm "Cập nhật từ ngày..." trong từng chính sách.`
        );
      } else if (queueDegradedCount > 0) {
        notices.push(
          `Đã thêm thành viên và cập nhật lịch, nhưng ${queueDegradedCount}/${activePolicyIds.length} chính sách chưa lên lịch nhắc ca qua queue. Hệ thống vẫn gửi thông báo phân ca Telegram ngay, nhưng bạn nên kiểm tra Redis/worker để nhắc ca tự động hoạt động ổn định.`
        );
      }
      if (teamNotice?.status === "skipped_no_telegram") {
        notices.push("Thành viên mới chưa liên kết Telegram nên chưa thể nhận thông báo cá nhân.");
      } else if (teamNotice?.status === "failed") {
        notices.push(
          `Thông báo Telegram khi thêm thành viên bị lỗi${teamNotice.error ? `: ${teamNotice.error}` : "."}`
        );
      }

      if (notices.length > 0) {
        setNotice(notices.join(" "));
      }

      router.refresh();
    } catch {
      setError("Không thể kết nối đến máy chủ");
    } finally {
      setLoading(false);
    }
  }

  if (availableUsers.length === 0) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={userId}
        onChange={(e) => setUserId(e.target.value)}
        className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 flex-1 bg-white text-gray-900"
      >
        <option value="">Chọn người dùng...</option>
        {availableUsers.map((u) => (
          <option key={u.id} value={u.id}>
            {u.fullName} ({u.email})
          </option>
        ))}
      </select>
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as "MEMBER" | "MANAGER")}
        className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-900"
      >
        <option value="MEMBER">Thành viên</option>
        <option value="MANAGER">Quản lý</option>
      </select>
      <button
        onClick={handleAdd}
        disabled={!userId || loading}
        className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "..." : "+ Thêm"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
      {notice && <span className="text-xs text-amber-700">{notice}</span>}
    </div>
  );
}
