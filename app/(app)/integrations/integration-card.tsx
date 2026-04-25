"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface IntegrationWithCount {
  id: string;
  name: string;
  type: string;
  token: string;
  isActive: boolean;
  team: { id: string; name: string };
  _count: { alerts: number };
}

const TYPE_LABELS: Record<string, string> = {
  GENERIC_WEBHOOK: "Generic Webhook",
  PROMETHEUS: "Prometheus AlertManager",
  GRAFANA: "Grafana",
};

const TYPE_COLORS: Record<string, string> = {
  GENERIC_WEBHOOK: "bg-gray-100 text-gray-700",
  PROMETHEUS: "bg-orange-100 text-orange-700",
  GRAFANA: "bg-yellow-100 text-yellow-700",
};

export function IntegrationCard({
  integration,
  canManage,
}: {
  integration: IntegrationWithCount;
  canManage: boolean;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const webhookUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/api/webhook/${integration.token}`;

  const copyUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleActive = async () => {
    setToggling(true);
    setToggleError(null);
    try {
      const res = await fetch(`/api/integrations/${integration.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !integration.isActive }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Không thể cập nhật");
      }
      router.refresh();
    } catch (e) {
      setToggleError(e instanceof Error ? e.message : "Lỗi");
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full shrink-0 ${integration.isActive ? "bg-green-500" : "bg-gray-300"}`} />
          <div>
            <div className="flex items-center gap-2">
              <p className="font-medium text-gray-900">{integration.name}</p>
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${TYPE_COLORS[integration.type] ?? "bg-gray-100 text-gray-700"}`}>
                {TYPE_LABELS[integration.type] ?? integration.type}
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">{integration.team.name} · {integration._count.alerts} alerts</p>
          </div>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <button
              onClick={toggleActive}
              disabled={toggling}
              className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors disabled:opacity-40 ${
                integration.isActive
                  ? "border-red-200 text-red-600 hover:bg-red-50"
                  : "border-green-200 text-green-600 hover:bg-green-50"
              }`}
            >
              {integration.isActive ? "Tắt" : "Bật"}
            </button>
            <Link
              href={`/alerts?integrationId=${integration.id}`}
              className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Xem alerts
            </Link>
          </div>
        )}
      </div>

      {toggleError && (
        <p className="px-5 pb-2 text-xs text-red-600">{toggleError}</p>
      )}
      {/* Webhook URL */}
      <div className="px-5 pb-4">
        <p className="text-xs font-medium text-gray-500 mb-1.5">Webhook URL</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-gray-700 truncate font-mono">
            POST /api/webhook/{integration.token}
          </code>
          <button
            onClick={copyUrl}
            className="shrink-0 text-xs px-2.5 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
          >
            {copied ? "✓ Đã sao chép" : "Sao chép"}
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-1.5">
          Gửi POST request với JSON body có trường <code className="font-mono">title</code>.
          Thêm <code className="font-mono">status: "resolved"</code> để tự động resolve.
        </p>
      </div>
    </div>
  );
}
