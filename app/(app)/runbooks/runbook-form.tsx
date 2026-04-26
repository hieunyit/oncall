"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface RunbookFormProps {
  teams: { id: string; name: string }[];
  defaultTeamId?: string;
  initial?: {
    id: string;
    teamId: string;
    title: string;
    content: string;
    keywords: string[];
  };
}

export function RunbookForm({ teams, defaultTeamId, initial }: RunbookFormProps) {
  const router = useRouter();
  const isEdit = !!initial;

  const [teamId, setTeamId] = useState(initial?.teamId ?? defaultTeamId ?? teams[0]?.id ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [keywordInput, setKeywordInput] = useState(initial?.keywords.join(", ") ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const keywords = keywordInput
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);

    const url = isEdit ? `/api/runbooks/${initial.id}` : "/api/runbooks";
    const method = isEdit ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId, title, content, keywords }),
    });

    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Có lỗi xảy ra");
      setLoading(false);
      return;
    }

    const d = await res.json();
    router.push(`/runbooks/${isEdit ? initial.id : d.data.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      {/* Team */}
      {!isEdit && teams.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Nhóm trực</label>
          <select
            required
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">Chọn nhóm...</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Title */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Tiêu đề</label>
        <input
          required
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ví dụ: Xử lý CPU spike trên server web"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      {/* Keywords */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Keywords <span className="text-gray-400 font-normal">(phân cách bằng dấu phẩy)</span>
        </label>
        <input
          type="text"
          value={keywordInput}
          onChange={(e) => setKeywordInput(e.target.value)}
          placeholder="high_cpu, web_server, nginx, timeout"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <p className="text-xs text-gray-400 mt-1">
          Dùng để match tự động khi alert có title chứa những từ khoá này.
        </p>
      </div>

      {/* Content */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="block text-sm font-medium text-gray-700">Nội dung hướng dẫn</label>
          <button
            type="button"
            onClick={() => setPreview((p) => !p)}
            className="text-xs text-indigo-600 hover:text-indigo-800"
          >
            {preview ? "Chỉnh sửa" : "Xem trước"}
          </button>
        </div>
        {preview ? (
          <div className="min-h-[360px] border border-gray-200 rounded-lg px-4 py-3 bg-white overflow-auto">
            <pre className="whitespace-pre-wrap text-sm text-gray-800 font-sans leading-relaxed">
              {content || <span className="text-gray-400 italic">Chưa có nội dung</span>}
            </pre>
          </div>
        ) : (
          <textarea
            required
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={18}
            placeholder={`## Triệu chứng\n- CPU > 90% liên tục\n- Response time tăng bất thường\n\n## Các bước xử lý\n1. SSH vào server: ssh admin@web-01\n2. Kiểm tra process nào đang ăn CPU: top -bn1 | head -20\n3. ...\n\n## Escalation\nNếu không giải quyết trong 15 phút → ping @team-lead`}
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm font-mono text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
          />
        )}
        <p className="text-xs text-gray-400 mt-1">
          Hỗ trợ plain text. Dùng ## cho tiêu đề, - cho danh sách, ``` cho code block.
        </p>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={loading}
          className="px-5 py-2.5 bg-indigo-600 text-white font-medium text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? "Đang lưu..." : isEdit ? "Lưu thay đổi" : "Tạo runbook"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="px-4 py-2.5 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg"
        >
          Huỷ
        </button>
      </div>
    </form>
  );
}
