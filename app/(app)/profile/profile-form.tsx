"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface UserProfile {
  id: string;
  fullName: string;
  timezone: string | null;
  telegramChatId: string | null;
  teamsConversationId: string | null;
  phone: string | null;
}

export function ProfileForm({ user }: { user: UserProfile }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    fullName: user.fullName ?? "",
    timezone: user.timezone ?? "Asia/Ho_Chi_Minh",
    telegramChatId: user.telegramChatId ?? "",
    teamsConversationId: user.teamsConversationId ?? "",
    phone: user.phone ?? "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);

    const body: Record<string, string | null> = {
      fullName: form.fullName,
      timezone: form.timezone || null,
      telegramChatId: form.telegramChatId || null,
      teamsConversationId: form.teamsConversationId || null,
      phone: form.phone || null,
    };

    const res = await fetch("/api/users/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Kênh thông báo</p>

        <div className="space-y-3">
          {/* Telegram */}
          <div className="flex items-start gap-3 p-3.5 rounded-lg bg-blue-50 border border-blue-100">
            <div className="w-8 h-8 rounded-lg bg-[#2CA5E0] flex items-center justify-center shrink-0 mt-0.5">
              <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z"/>
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-800">Telegram</p>
              <p className="text-xs text-gray-500 mb-2">Chat ID từ bot @oncall_notify_bot (gõ /start để lấy)</p>
              <input
                className="input w-full bg-white"
                placeholder="Ví dụ: 123456789"
                value={form.telegramChatId}
                onChange={e => setForm(f => ({ ...f, telegramChatId: e.target.value }))}
              />
            </div>
          </div>

          {/* MS Teams */}
          <div className="flex items-start gap-3 p-3.5 rounded-lg bg-purple-50 border border-purple-100">
            <div className="w-8 h-8 rounded-lg bg-[#6264A7] flex items-center justify-center shrink-0 mt-0.5">
              <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.625 7.05h-3.375V5.175a2.025 2.025 0 10-4.05 0v.675h-1.8a.675.675 0 00-.675.675v3.15h9.9a.675.675 0 00.675-.675V7.725a.675.675 0 00-.675-.675zm-9 1.8H8.25V6.525a.675.675 0 00-.675-.675H3.375a.675.675 0 00-.675.675v9.9c0 .373.302.675.675.675h4.2c.373 0 .675-.302.675-.675V8.85zm9.675 1.35H11.7v6.525c0 .745-.604 1.35-1.35 1.35h-.675v.45c0 .745.604 1.35 1.35 1.35h9.3c.745 0 1.35-.604 1.35-1.35v-7.2a.675.675 0 00-.675-.675l.3-.45z"/>
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-800">Microsoft Teams</p>
              <p className="text-xs text-gray-500 mb-2">Conversation ID từ Teams (liên hệ admin để lấy)</p>
              <input
                className="input w-full bg-white"
                placeholder="19:xxxx@thread.v2"
                value={form.teamsConversationId}
                onChange={e => setForm(f => ({ ...f, teamsConversationId: e.target.value }))}
              />
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
