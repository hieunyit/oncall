"use client";

import { useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";

interface MonthOption {
  value: string;
  label: string;
}

interface Team {
  id: string;
  name: string;
}

interface Policy {
  id: string;
  name: string;
  teamId: string;
}

export function ReportsFilters({
  monthOptions,
  selectedMonth,
  teams,
  policies,
  selectedTeamId,
  selectedPolicyId,
  showAllTeams,
}: {
  monthOptions: MonthOption[];
  selectedMonth: string;
  teams: Team[];
  policies: Policy[];
  selectedTeamId?: string;
  selectedPolicyId?: string;
  showAllTeams: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const visiblePolicies = useMemo(
    () => (selectedTeamId ? policies.filter((p) => p.teamId === selectedTeamId) : policies),
    [policies, selectedTeamId]
  );

  const navigate = (month: string, teamId: string, policyId: string) => {
    const params = new URLSearchParams();
    params.set("month", month);
    if (teamId) params.set("teamId", teamId);
    if (policyId) params.set("policyId", policyId);

    startTransition(() => {
      router.replace(`/reports?${params.toString()}`);
    });
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[170px]">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Tháng
          </span>
          <select
            className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700"
            value={selectedMonth}
            onChange={(e) =>
              navigate(e.target.value, selectedTeamId ?? "", selectedPolicyId ?? "")
            }
          >
            {monthOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {(teams.length > 1 || showAllTeams) && (
          <label className="min-w-[180px]">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Nhóm trực
            </span>
            <select
              className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700"
              value={selectedTeamId ?? ""}
              onChange={(e) => navigate(selectedMonth, e.target.value, "")}
            >
              {showAllTeams && <option value="">Tất cả nhóm</option>}
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {visiblePolicies.length > 0 && (
          <label className="min-w-[200px]">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Chính sách
            </span>
            <select
              className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700"
              value={selectedPolicyId ?? ""}
              onChange={(e) => navigate(selectedMonth, selectedTeamId ?? "", e.target.value)}
            >
              <option value="">Tất cả chính sách</option>
              {visiblePolicies.map((policy) => (
                <option key={policy.id} value={policy.id}>
                  {policy.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="mt-2 min-h-4 text-[11px] text-gray-500">
        {isPending ? "Đang tải số liệu..." : "Bộ lọc áp dụng ngay khi bạn thay đổi."}
      </div>
    </div>
  );
}
