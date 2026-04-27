"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { vi } from "date-fns/locale";

interface BatchItem {
  id: string;
  rangeStart: Date;
  rangeEnd: Date;
  status: string;
  _count: { shifts: number };
}

interface Props {
  batches: BatchItem[];
}

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  PUBLISHED: { label: "Đã publish", cls: "bg-green-100 text-green-700" },
  ROLLED_BACK: { label: "Đã rollback", cls: "bg-gray-100 text-gray-500" },
  PARTIAL: { label: "Một phần", cls: "bg-orange-100 text-orange-700" },
};

export function BatchList({ batches }: Props) {
  const router = useRouter();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");

  // Reschedule modal state
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState("");
  const [rescheduleLoading, setRescheduleLoading] = useState(false);
  const [rescheduleError, setRescheduleError] = useState("");
  const [rescheduleResult, setRescheduleResult] = useState<{ removedShifts: number; newShifts: number } | null>(null);

  async function handleRollback(batchId: string) {
    setLoadingId(batchId);
    setErrorId(null);
    setErrorMsg("");
    const res = await fetch(`/api/schedules/batches/${batchId}/rollback`, { method: "POST" });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setErrorId(batchId);
      setErrorMsg(d.error ?? "Rollback thất bại");
    } else {
      router.refresh();
    }
    setLoadingId(null);
  }

  function openReschedule(batch: BatchItem) {
    setRescheduleId(batch.id);
    // Default fromDate = today (or rangeStart if today is before rangeStart)
    const today = new Date();
    const defaultDate = today > new Date(batch.rangeStart) ? today : new Date(batch.rangeStart);
    setFromDate(format(defaultDate, "yyyy-MM-dd"));
    setRescheduleError("");
    setRescheduleResult(null);
  }

  async function handleReschedule() {
    if (!rescheduleId || !fromDate) return;
    setRescheduleLoading(true);
    setRescheduleError("");
    setRescheduleResult(null);

    const res = await fetch(`/api/schedules/batches/${rescheduleId}/reschedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromDate: new Date(fromDate).toISOString() }),
    });

    const data = await res.json().catch(() => ({}));
    setRescheduleLoading(false);

    if (!res.ok) {
      setRescheduleError(data.error ?? "Cập nhật thất bại");
    } else {
      setRescheduleResult({ removedShifts: data.removedShifts, newShifts: data.newShifts });
      router.refresh();
    }
  }

  if (batches.length === 0) {
    return <p className="px-5 py-8 text-center text-gray-400 text-sm">Chưa có lô lịch nào.</p>;
  }

  return (
    <>
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="text-left px-4 py-2 font-medium text-gray-500">Từ ngày</th>
            <th className="text-left px-4 py-2 font-medium text-gray-500">Đến ngày</th>
            <th className="text-left px-4 py-2 font-medium text-gray-500">Trạng thái</th>
            <th className="text-left px-4 py-2 font-medium text-gray-500">Số ca</th>
            <th className="text-right px-4 py-2 font-medium text-gray-500">Hành động</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {batches.map((batch) => {
            const st = STATUS_LABELS[batch.status] ?? { label: batch.status, cls: "bg-gray-100 text-gray-500" };
            return (
              <tr key={batch.id}>
                <td className="px-4 py-2 text-gray-700">
                  {new Date(batch.rangeStart).toLocaleDateString("vi-VN")}
                </td>
                <td className="px-4 py-2 text-gray-700">
                  {new Date(batch.rangeEnd).toLocaleDateString("vi-VN")}
                </td>
                <td className="px-4 py-2">
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${st.cls}`}>
                    {st.label}
                  </span>
                </td>
                <td className="px-4 py-2 text-gray-700">{batch._count.shifts}</td>
                <td className="px-4 py-2 text-right">
                  {batch.status === "PUBLISHED" && (
                    <div className="inline-flex flex-col items-end gap-1">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openReschedule(batch)}
                          className="text-xs px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded font-medium"
                        >
                          Cập nhật từ ngày...
                        </button>
                        <button
                          onClick={() => handleRollback(batch.id)}
                          disabled={loadingId === batch.id}
                          className="text-xs px-2 py-1 bg-red-50 hover:bg-red-100 text-red-600 rounded font-medium disabled:opacity-50"
                        >
                          {loadingId === batch.id ? "..." : "Rollback"}
                        </button>
                      </div>
                      {errorId === batch.id && (
                        <span className="text-xs text-red-600">{errorMsg}</span>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Reschedule modal */}
      {rescheduleId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-1">Cập nhật lịch trực từ ngày</h3>
            <p className="text-sm text-gray-500 mb-4">
              Các ca trực từ ngày bạn chọn trở đi sẽ được tạo lại theo danh sách thành viên hiện tại.
              Các ca đã trực hoặc đang diễn ra <strong>sẽ không bị thay đổi</strong>.
            </p>

            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Bắt đầu cập nhật từ ngày
            </label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="input w-full mb-4"
            />

            {rescheduleError && (
              <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg mb-3">{rescheduleError}</p>
            )}

            {rescheduleResult && (
              <p className="text-sm text-green-600 bg-green-50 px-3 py-2 rounded-lg mb-3">
                ✓ Đã xóa {rescheduleResult.removedShifts} ca cũ, tạo {rescheduleResult.newShifts} ca mới.
              </p>
            )}

            <div className="flex justify-end gap-2 mt-2">
              <button
                onClick={() => setRescheduleId(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Đóng
              </button>
              {!rescheduleResult && (
                <button
                  onClick={handleReschedule}
                  disabled={rescheduleLoading || !fromDate}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 transition-colors"
                >
                  {rescheduleLoading ? "Đang cập nhật..." : "Cập nhật lịch trực"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
