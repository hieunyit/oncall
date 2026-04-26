"use client";

interface MonthOption { value: string; label: string }
interface Team { id: string; name: string }
interface Policy { id: string; name: string; teamId: string }

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
  const navigate = (month: string, teamId: string, policyId: string) => {
    const params = new URLSearchParams();
    params.set("month", month);
    if (teamId) params.set("teamId", teamId);
    if (policyId) params.set("policyId", policyId);
    window.location.href = `/reports?${params.toString()}`;
  };

  const visiblePolicies = selectedTeamId
    ? policies.filter((p) => p.teamId === selectedTeamId)
    : policies;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700"
        value={selectedMonth}
        onChange={(e) => navigate(e.target.value, selectedTeamId ?? "", selectedPolicyId ?? "")}
      >
        {monthOptions.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {(teams.length > 1 || showAllTeams) && (
        <select
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700"
          value={selectedTeamId ?? ""}
          onChange={(e) => navigate(selectedMonth, e.target.value, "")}
        >
          {showAllTeams && <option value="">Tất cả nhóm</option>}
          {teams.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      )}
      {visiblePolicies.length > 0 && (
        <select
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700"
          value={selectedPolicyId ?? ""}
          onChange={(e) => navigate(selectedMonth, selectedTeamId ?? "", e.target.value)}
        >
          <option value="">Tất cả lịch trực</option>
          {visiblePolicies.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      )}
    </div>
  );
}
