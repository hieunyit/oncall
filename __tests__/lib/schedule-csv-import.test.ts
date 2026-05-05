import { describe, expect, it } from "vitest";
import {
  combineScheduleDateTime,
  normalizeScheduleIdentity,
  parseScheduleCsv,
  parseScheduleDate,
  parseScheduleTime,
} from "@/lib/schedule/csv-import";

describe("parseScheduleCsv", () => {
  it("parses valid CSV rows with separated date/time columns", () => {
    const csv = [
      "startDate,startTime,endDate,endTime,assignee,backup,notes",
      "2026-06-01,08:00,2026-06-01,20:00,member1@example.com,member2@example.com,Ca ngay",
      "2026-06-01,20:00,2026-06-02,08:00,member2@example.com,,Ca dem",
    ].join("\n");

    const result = parseScheduleCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].startDateText).toBe("2026-06-01");
    expect(result.rows[0].startTimeText).toBe("08:00");
    expect(result.rows[1].backupText).toBeNull();
  });

  it("supports vietnamese headers with accents", () => {
    const csv = [
      "Ngày bắt đầu,Giờ bắt đầu,Ngày kết thúc,Giờ kết thúc,Người trực,Dự phòng,Ghi chú",
      "01/06/2026,08:00,01/06/2026,20:00,member1@example.com,member2@example.com,Ghi chu",
    ].join("\n");

    const result = parseScheduleCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].startDateText).toBe("01/06/2026");
  });

  it("returns error when required header is missing", () => {
    const csv = [
      "startDate,startTime,endDate,assignee",
      "2026-06-01,08:00,2026-06-01,member1@example.com",
    ].join("\n");
    const result = parseScheduleCsv(csv);

    expect(result.rows).toEqual([]);
    expect(result.errors.some((error) => error.field === "header")).toBe(true);
  });
});

describe("parseScheduleDate", () => {
  it("parses yyyy-MM-dd", () => {
    const parsed = parseScheduleDate("2026-06-01");
    expect(parsed).not.toBeNull();
    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(5);
    expect(parsed?.getDate()).toBe(1);
  });

  it("parses dd/MM/yyyy", () => {
    const parsed = parseScheduleDate("01/06/2026");
    expect(parsed).not.toBeNull();
    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(5);
    expect(parsed?.getDate()).toBe(1);
  });
});

describe("parseScheduleTime", () => {
  it("parses HH:mm", () => {
    const parsed = parseScheduleTime("08:30");
    expect(parsed).toEqual({ hour: 8, minute: 30, second: 0 });
  });

  it("returns null for invalid time", () => {
    expect(parseScheduleTime("99:00")).toBeNull();
  });
});

describe("combineScheduleDateTime", () => {
  it("combines date and time into a Date", () => {
    const combined = combineScheduleDateTime("2026-06-01", "20:15");
    expect(combined).not.toBeNull();
    expect(combined?.getFullYear()).toBe(2026);
    expect(combined?.getMonth()).toBe(5);
    expect(combined?.getDate()).toBe(1);
    expect(combined?.getHours()).toBe(20);
    expect(combined?.getMinutes()).toBe(15);
  });
});

describe("normalizeScheduleIdentity", () => {
  it("removes accents and punctuation", () => {
    const key = normalizeScheduleIdentity("Nguyễn Văn A");
    expect(key).toBe("nguyenvana");
  });
});
