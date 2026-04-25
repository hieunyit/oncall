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
  GENERIC_WEBHOOK: "bg-gray-100 text-gray-700 ring-1 ring-gray-200",
  PROMETHEUS: "bg-orange-100 text-orange-700 ring-1 ring-orange-200",
  GRAFANA: "bg-yellow-100 text-yellow-700 ring-1 ring-yellow-200",
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  GENERIC_WEBHOOK: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
    </svg>
  ),
  PROMETHEUS: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  ),
  GRAFANA: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  ),
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
    <div className={`bg-white rounded-xl border overflow-hidden transition-shadow hover:shadow-sm ${integration.isActive ? "border-gray-200" : "border-gray-100 opacity-75"}`}>
      <div className="px-5 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          {/* Status dot */}
          <div className="relative shrink-0">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${integration.isActive ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-400"}`}>
              {TYPE_ICONS[integration.type] ?? TYPE_ICONS.GENERIC_WEBHOOK}
            </div>
            <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${integration.isActive ? "bg-green-500" : "bg-gray-300"}`} />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-gray-900 truncate">{integration.name}</p>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${TYPE_COLORS[integration.type] ?? "bg-gray-100 text-gray-700"}`}>
                {TYPE_LABELS[integration.type] ?? integration.type}
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              <span className="font-medium text-gray-500">{integration.team.name}</span>
              {" · "}
              <span>{integration._count.alerts} alerts</span>
            </p>
          </div>
        </div>

        {canManage && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={toggleActive}
              disabled={toggling}
              className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors disabled:opacity-40 ${
                integration.isActive
                  ? "border-red-200 text-red-600 hover:bg-red-50"
                  : "border-green-200 text-green-600 hover:bg-green-50"
              }`}
            >
              {integration.isActive ? "Tắt" : "Bật"}
            </button>
            <Link
              href={`/alerts?integrationId=${integration.id}`}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors font-medium"
            >
              Xem alerts
            </Link>
          </div>
        )}
      </div>

      {toggleError && (
        <p className="px-5 pb-2 text-xs text-red-600 bg-red-50 py-2 border-t border-red-100">{toggleError}</p>
      )}

      {/* Webhook URL */}
      <div className="px-5 pb-4 pt-0">
        <p className="text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">Webhook URL</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-gray-700 truncate font-mono">
            POST /api/webhook/{integration.token}
          </code>
          <button
            onClick={copyUrl}
            className={`shrink-0 text-xs px-3 py-2 rounded-lg border font-medium transition-colors ${
              copied
                ? "bg-green-50 border-green-200 text-green-700"
                : "border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            {copied ? "✓ Đã sao chép" : "Sao chép"}
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-1.5">
          Gửi POST request với JSON body có trường <code className="font-mono bg-gray-100 px-1 rounded">title</code>.
          Thêm <code className="font-mono bg-gray-100 px-1 rounded">status: "resolved"</code> để tự động resolve.
        </p>
      </div>
    </div>
  );
}
