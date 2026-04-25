"use client";

interface MonthOption { value: string; label: string }
interface Team { id: string; name: string }

export function ReportsFilters({
  monthOptions,
  selectedMonth,
  teams,
  selectedTeamId,
  showAllTeams,
}: {
  monthOptions: MonthOption[];
  selectedMonth: string;
  teams: Team[];
  selectedTeamId?: string;
  showAllTeams: boolean;
}) {
  const navigate = (month: string, teamId: string) => {
    const params = new URLSearchParams();
    params.set("month", month);
    if (teamId) params.set("teamId", teamId);
    window.location.href = `/reports?${params.toString()}`;
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        className="input text-sm"
        value={selectedMonth}
        onChange={(e) => navigate(e.target.value, selectedTeamId ?? "")}
      >
        {monthOptions.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {teams.length > 1 && (
        <select
          className="input text-sm"
          value={selectedTeamId ?? ""}
          onChange={(e) => navigate(selectedMonth, e.target.value)}
        >
          {showAllTeams && <option value="">Tất cả nhóm</option>}
          {teams.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      )}
    </div>
  );
}
