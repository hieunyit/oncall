import { describe, expect, it } from "vitest";
import { buildScheduleBackupCsv, SCHEDULE_BACKUP_SCHEMA } from "@/lib/schedule/backup";

describe("buildScheduleBackupCsv", () => {
  it("exports metadata rows and import-compatible headers", () => {
    const csv = buildScheduleBackupCsv({
      metadata: {
        teamName: "Ops",
        teamDescription: "NOC",
        policyName: "Primary",
        cadence: "WEEKLY",
        cronExpression: "",
        shiftDurationHours: 12,
        handoverOffsetMinutes: 0,
        confirmationDueHours: 24,
        reminderLeadHours: [48, 24, 2],
        maxGenerateWeeks: 4,
        timezone: "Asia/Ho_Chi_Minh",
        timeSlots: [],
        checklistRequired: false,
        templateTasks: [],
        telegramRequirePhotoOnConfirm: false,
        telegramEndShiftReminderEnabled: false,
        telegramRequirePhotoOnCheckout: false,
        teamMembers: [
          { email: "a@example.com", fullName: "Alice", role: "MANAGER", order: 0 },
          { email: "b@example.com", fullName: "Bob", role: "MEMBER", order: 1 },
        ],
        participantUserEmails: ["a@example.com", "b@example.com"],
      },
      shifts: [
        {
          startsAt: new Date("2026-06-01T01:00:00.000Z"),
          endsAt: new Date("2026-06-01T13:00:00.000Z"),
          assigneeEmail: "a@example.com",
          notes: "Ca ngay",
        },
      ],
    });

    expect(csv).toContain(`"meta","schema","${SCHEDULE_BACKUP_SCHEMA}"`);
    expect(csv).toContain('"meta","teamName","Ops"');
    expect(csv).toContain('""fullName"":""Alice""');
    expect(csv).toContain('"startDate","startTime","endDate","endTime","assignee","notes"');
    expect(csv).toContain('"a@example.com"');
    expect(csv).not.toContain('"backup"');
  });
});
