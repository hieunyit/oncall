export const SCHEDULE_BACKUP_SCHEMA = "oncall-backup-v1";

type TeamRoleValue = "MANAGER" | "MEMBER";

export type ScheduleBackupTeamMember = {
  email: string;
  fullName?: string;
  role: TeamRoleValue;
  order: number;
};

export type ScheduleBackupShift = {
  startsAt: Date;
  endsAt: Date;
  assigneeEmail: string;
  notes?: string | null;
};

export type ScheduleBackupMetadata = {
  teamName: string;
  teamDescription?: string | null;
  policyName: string;
  cadence: string;
  cronExpression?: string | null;
  shiftDurationHours: number;
  handoverOffsetMinutes: number;
  confirmationDueHours: number;
  reminderLeadHours: number[];
  maxGenerateWeeks: number;
  timezone: string;
  timeSlots?: unknown;
  checklistRequired?: boolean;
  templateTasks?: string[];
  telegramRequirePhotoOnConfirm?: boolean;
  telegramEndShiftReminderEnabled?: boolean;
  telegramRequirePhotoOnCheckout?: boolean;
  teamMembers: ScheduleBackupTeamMember[];
  participantUserEmails: string[];
  exportRangeStart?: Date;
  exportRangeEnd?: Date;
};

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function formatDateTimeInTimezone(date: Date, timezone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);

  const lookup = new Map(parts.map((part) => [part.type, part.value]));
  const yyyy = lookup.get("year") ?? "1970";
  const mm = lookup.get("month") ?? "01";
  const dd = lookup.get("day") ?? "01";
  const hh = lookup.get("hour") ?? "00";
  const min = lookup.get("minute") ?? "00";

  return {
    date: `${yyyy}-${mm}-${dd}`,
    time: `${hh}:${min}`,
  };
}

function normalizeMemberList(members: ScheduleBackupTeamMember[]): ScheduleBackupTeamMember[] {
  return [...members]
    .filter((member) => member.email.trim().length > 0)
    .map((member) => {
      const role: TeamRoleValue = member.role === "MANAGER" ? "MANAGER" : "MEMBER";
      const fullName = member.fullName?.trim() ?? "";
      return {
        email: member.email.trim().toLowerCase(),
        ...(fullName ? { fullName } : {}),
        role,
        order: Number.isFinite(member.order) ? Math.max(0, Math.floor(member.order)) : 0,
      };
    })
    .sort((a, b) => a.order - b.order || a.email.localeCompare(b.email));
}

function normalizeParticipantEmails(emails: string[]): string[] {
  return [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
}

export function buildScheduleBackupCsv(input: {
  metadata: ScheduleBackupMetadata;
  shifts: ScheduleBackupShift[];
}): string {
  const { metadata } = input;
  const timezone = metadata.timezone || "Asia/Ho_Chi_Minh";
  const teamMembers = normalizeMemberList(metadata.teamMembers);
  const participantUserEmails = normalizeParticipantEmails(metadata.participantUserEmails);

  const metaRows: string[][] = [
    ["meta", "schema", SCHEDULE_BACKUP_SCHEMA],
    ["meta", "teamName", metadata.teamName],
    ["meta", "teamDescription", metadata.teamDescription ?? ""],
    ["meta", "policyName", metadata.policyName],
    ["meta", "cadence", metadata.cadence],
    ["meta", "cronExpression", metadata.cronExpression ?? ""],
    ["meta", "shiftDurationHours", String(metadata.shiftDurationHours)],
    ["meta", "handoverOffsetMinutes", String(metadata.handoverOffsetMinutes)],
    ["meta", "confirmationDueHours", String(metadata.confirmationDueHours)],
    ["meta", "reminderLeadHours", JSON.stringify(metadata.reminderLeadHours ?? [])],
    ["meta", "maxGenerateWeeks", String(metadata.maxGenerateWeeks)],
    ["meta", "timezone", timezone],
    ["meta", "timeSlots", JSON.stringify(metadata.timeSlots ?? [])],
    ["meta", "checklistRequired", String(Boolean(metadata.checklistRequired))],
    ["meta", "templateTasks", JSON.stringify(metadata.templateTasks ?? [])],
    [
      "meta",
      "telegramRequirePhotoOnConfirm",
      String(Boolean(metadata.telegramRequirePhotoOnConfirm)),
    ],
    [
      "meta",
      "telegramEndShiftReminderEnabled",
      String(Boolean(metadata.telegramEndShiftReminderEnabled)),
    ],
    [
      "meta",
      "telegramRequirePhotoOnCheckout",
      String(Boolean(metadata.telegramRequirePhotoOnCheckout)),
    ],
    ["meta", "teamMembers", JSON.stringify(teamMembers)],
    ["meta", "participantUserEmails", JSON.stringify(participantUserEmails)],
    ["meta", "exportedAt", new Date().toISOString()],
    ["meta", "exportRangeStart", metadata.exportRangeStart?.toISOString() ?? ""],
    ["meta", "exportRangeEnd", metadata.exportRangeEnd?.toISOString() ?? ""],
  ];

  const dataHeader = ["startDate", "startTime", "endDate", "endTime", "assignee", "notes"];
  const dataRows = [...input.shifts]
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.endsAt.getTime() - b.endsAt.getTime())
    .map((shift) => {
      const start = formatDateTimeInTimezone(shift.startsAt, timezone);
      const end = formatDateTimeInTimezone(shift.endsAt, timezone);
      return [
        start.date,
        start.time,
        end.date,
        end.time,
        shift.assigneeEmail.trim().toLowerCase(),
        shift.notes ?? "",
      ];
    });

  const allRows = [...metaRows, dataHeader, ...dataRows];
  return allRows.map((row) => row.map((cell) => csvEscape(cell)).join(",")).join("\r\n");
}
