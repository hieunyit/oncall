"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface UserProfile {
  id: string;
  fullName: string;
  timezone: string | null;
  telegramChatId: string | null;
  phone: string | null;
  systemRole?: string;
}

export function ProfileForm({ user }: { user: UserProfile }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [checkingTg, setCheckingTg] = useState(false);
  const [setupWebhook, setSetupWebhook] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [form, setForm] = useState({
    fullName: user.fullName ?? "",
    timezone: user.timezone ?? "Asia/Ho_Chi_Minh",
    phone: user.phone ?? "",
  });

  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
  const telegramDeepLink = botUsername
    ? `https://t.me/${botUsername}?start=${user.id}`
    : null;

  async function checkTelegramStatus() {
    setCheckingTg(true);
    try {
      const res = await fetch("/api/users/me");
      if (res.ok) {
        const data = await res.json();
        if (data.telegramChatId) router.refresh();
      }
    } finally {
      setCheckingTg(false);
    }
  }

  async function registerWebhook() {
    setSetupWebhook("loading");
    try {
      const res = await fetch("/api/telegram/setup", { method: "POST" });
      setSetupWebhook(res.ok ? "ok" : "err");
    } catch {
      setSetupWebhook("err");
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);

    const res = await fetch("/api/users/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: form.fullName,
        timezone: form.timezone || null,
        phone: form.phone || null,
      }),
    });

    setSaving(false);
    if (res.ok) {
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 3000);
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Không thể lưu thay đổi.");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-5 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">Họ và tên</label>
          <input
            className="input w-full"
            value={form.fullName}
            onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))}
            required
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">Múi giờ</label>
          <select
            className="input w-full"
            value={form.timezone}
            onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))}
          >
            <option value="Asia/Ho_Chi_Minh">Asia/Ho_Chi_Minh (UTC+7)</option>
            <option value="Asia/Bangkok">Asia/Bangkok (UTC+7)</option>
            <option value="Asia/Singapore">Asia/Singapore (UTC+8)</option>
            <option value="UTC">UTC</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1.5">Số điện thoại</label>
        <input
          className="input w-full"
          placeholder="+84..."
          value={form.phone}
          onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
        />
      </div>

      {/* Notification channels */}
      <div className="pt-2 border-t border-gray-100">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Kênh thông báo cá nhân</p>

        <div className="space-y-3">
          {/* Telegram */}
          <div className="flex items-start gap-3 p-3.5 rounded-lg bg-blue-50 border border-blue-100">
            <div className="w-8 h-8 rounded-lg bg-[#2CA5E0] flex items-center justify-center shrink-0 mt-0.5">
              <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z"/>
              </svg>
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-800">Telegram</p>
                {user.telegramChatId ? (
                  <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                    Đã kết nối (ID: {user.telegramChatId})
                  </span>
                ) : (
                  <span className="text-xs text-gray-400">Chưa kết nối</span>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-1 mb-2">
                Nhấn nút bên dưới để mở bot Telegram và liên kết tài khoản tự động.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {telegramDeepLink ? (
                  <a
                    href={telegramDeepLink}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#2CA5E0] text-white text-xs font-medium rounded-lg hover:bg-[#239fd6] transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z"/>
                    </svg>
                    {user.telegramChatId ? "Kết nối lại Telegram" : "Kết nối Telegram"}
                  </a>
                ) : (
                  <p className="text-xs text-amber-600 bg-amber-50 px-2.5 py-1.5 rounded">
                    Cần cấu hình <code className="font-mono">NEXT_PUBLIC_TELEGRAM_BOT_USERNAME</code> trong .env
                  </p>
                )}
                {!user.telegramChatId && telegramDeepLink && (
                  <button
                    type="button"
                    onClick={checkTelegramStatus}
                    disabled={checkingTg}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
                  >
                    {checkingTg ? "Đang kiểm tra..." : "↻ Kiểm tra trạng thái"}
                  </button>
                )}
              </div>
              {/* Admin: register Telegram webhook */}
              {user.systemRole === "ADMIN" && (
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={registerWebhook}
                    disabled={setupWebhook === "loading"}
                    className="text-xs text-gray-500 underline hover:text-gray-700 disabled:opacity-50"
                  >
                    {setupWebhook === "loading" ? "Đang đăng ký..." : "Đăng ký Telegram Webhook"}
                  </button>
                  {setupWebhook === "ok" && <span className="text-xs text-green-600">✓ Thành công</span>}
                  {setupWebhook === "err" && <span className="text-xs text-red-600">✗ Lỗi</span>}
                </div>
              )}
            </div>
          </div>

          {/* Teams note */}
          <div className="flex items-start gap-3 p-3.5 rounded-lg bg-purple-50 border border-purple-100">
            <div className="w-8 h-8 rounded-lg bg-[#6264A7] flex items-center justify-center shrink-0 mt-0.5">
              <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.625 7.05h-3.375V5.175a2.025 2.025 0 10-4.05 0v.675h-1.8a.675.675 0 00-.675.675v3.15h9.9a.675.675 0 00.675-.675V7.725a.675.675 0 00-.675-.675zm-9 1.8H8.25V6.525a.675.675 0 00-.675-.675H3.375a.675.675 0 00-.675.675v9.9c0 .373.302.675.675.675h4.2c.373 0 .675-.302.675-.675V8.85zm9.675 1.35H11.7v6.525c0 .745-.604 1.35-1.35 1.35h-.675v.45c0 .745.604 1.35 1.35 1.35h9.3c.745 0 1.35-.604 1.35-1.35v-7.2a.675.675 0 00-.675-.675l.3-.45z"/>
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-800">Microsoft Teams</p>
              <p className="text-xs text-gray-500 mt-1">
                Thông báo Teams được gửi đến kênh nhóm (Incoming Webhook), cấu hình bởi quản lý nhóm trong trang <strong>Nhóm trực → Kênh thông báo</strong>.
              </p>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
      )}

      <div className="flex items-center justify-between pt-1">
        {saved && (
          <span className="text-sm text-green-600 flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/>
            </svg>
            Đã lưu thành công
          </span>
        )}
        {!saved && <span />}
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
        >
          {saving ? "Đang lưu..." : "Lưu thay đổi"}
        </button>
      </div>
    </form>
  );
}
