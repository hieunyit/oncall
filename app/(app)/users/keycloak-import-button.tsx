"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

interface KcUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  enabled: boolean;
}

interface ExistingUser {
  email: string;
}

interface Props {
  existingEmails: string[];
}

export function KeycloakImportButton({ existingEmails }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KcUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleQueryChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!val.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => doSearch(val), 400);
  }

  async function doSearch(q: string) {
    setSearching(true);
    setError(null);
    const res = await fetch(`/api/keycloak/users?q=${encodeURIComponent(q)}`);
    if (res.ok) {
      const d = await res.json();
      setResults(d.data ?? []);
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Lỗi tìm kiếm");
    }
    setSearching(false);
  }

  async function handleImport(user: KcUser) {
    setImportingId(user.id);
    setError(null);
    const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
    const res = await fetch("/api/keycloak/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keycloakId: user.id, email: user.email, fullName }),
    });
    if (res.ok) {
      setImportedIds((prev) => new Set(prev).add(user.id));
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Không thể import");
    }
    setImportingId(null);
  }

  function handleClose() {
    setOpen(false);
    setQuery("");
    setResults([]);
    setError(null);
    setImportedIds(new Set());
  }

  const existingEmailSet = new Set(existingEmails);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
      >
        Tìm từ Keycloak
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-gray-900">Tìm người dùng từ Keycloak</h2>
                <p className="text-xs text-gray-500 mt-0.5">Tìm kiếm và thêm người dùng từ Keycloak vào hệ thống.</p>
              </div>
              <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <input
                type="text"
                autoFocus
                placeholder="Tìm theo tên hoặc email..."
                value={query}
                onChange={handleQueryChange}
                className="input w-full"
              />

              {error && (
                <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
              )}

              {searching && (
                <p className="text-sm text-gray-400 text-center py-4">Đang tìm kiếm...</p>
              )}

              {!searching && results.length === 0 && query.trim() && (
                <p className="text-sm text-gray-400 text-center py-4">Không tìm thấy người dùng.</p>
              )}

              {results.length > 0 && (
                <div className="divide-y divide-gray-50 max-h-72 overflow-y-auto border border-gray-100 rounded-lg">
                  {results.map((user) => {
                    const alreadyExists = existingEmailSet.has(user.email ?? "") || importedIds.has(user.id);
                    const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ") || "—";
                    return (
                      <div key={user.id} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
                        <div className="min-w-0">
                          <p className="font-medium text-gray-900 text-sm truncate">{fullName}</p>
                          <p className="text-xs text-gray-400 truncate">{user.email}</p>
                          {!user.enabled && (
                            <span className="text-xs text-red-500">Vô hiệu hoá</span>
                          )}
                        </div>
                        {alreadyExists ? (
                          <span className="text-xs text-green-600 font-medium shrink-0 ml-3">Đã có</span>
                        ) : (
                          <button
                            onClick={() => handleImport(user)}
                            disabled={importingId === user.id}
                            className="ml-3 shrink-0 text-xs px-3 py-1 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                          >
                            {importingId === user.id ? "..." : "Thêm"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
