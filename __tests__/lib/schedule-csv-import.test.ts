import { describe, expect, it } from "vitest";
import {
  normalizeScheduleIdentity,
  parseScheduleCsv,
  parseScheduleDateTime,
} from "@/lib/schedule/csv-import";

describe("parseScheduleCsv", () => {
  it("parses valid CSV rows with english headers", () => {
    const csv = [
      "startsAt,endsAt,assignee,backup,notes",
      "2026-06-01 08:00,2026-06-01 20:00,member1@example.com,member2@example.com,Ca ngay",
      "2026-06-01 20:00,2026-06-02 08:00,member2@example.com,,Ca dem",
    ].join("\n");

    const result = parseScheduleCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].assigneeText).toBe("member1@example.com");
    expect(result.rows[1].backupText).toBeNull();
  });

  it("supports vietnamese headers with accents", () => {
    const csv = [
      "Bắt đầu,Kết thúc,Người trực,Dự phòng,Ghi chú",
      "01/06/2026 08:00,01/06/2026 20:00,member1@example.com,member2@example.com,Ghi chu",
    ].join("\n");

    const result = parseScheduleCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].startsAtText).toBe("01/06/2026 08:00");
  });

  it("keeps commas inside quoted fields", () => {
    const csv = [
      "startsAt,endsAt,assignee,notes",
      "2026-06-01 08:00,2026-06-01 20:00,member1@example.com,\"Ca ngay, uu tien\"",
    ].join("\n");

    const result = parseScheduleCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.rows[0].notes).toBe("Ca ngay, uu tien");
  });

  it("returns error when required header is missing", () => {
    const csv = ["startsAt,assignee", "2026-06-01 08:00,member1@example.com"].join("\n");
    const result = parseScheduleCsv(csv);

    expect(result.rows).toEqual([]);
    expect(result.errors.some((error) => error.field === "header")).toBe(true);
  });
});

describe("parseScheduleDateTime", () => {
  it("parses yyyy-MM-dd HH:mm", () => {
    const parsed = parseScheduleDateTime("2026-06-01 08:30");
    expect(parsed).not.toBeNull();
    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(5);
    expect(parsed?.getDate()).toBe(1);
    expect(parsed?.getHours()).toBe(8);
    expect(parsed?.getMinutes()).toBe(30);
  });

  it("parses dd/MM/yyyy HH:mm", () => {
    const parsed = parseScheduleDateTime("01/06/2026 20:15");
    expect(parsed).not.toBeNull();
    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(5);
    expect(parsed?.getDate()).toBe(1);
    expect(parsed?.getHours()).toBe(20);
    expect(parsed?.getMinutes()).toBe(15);
  });

  it("returns null for invalid date", () => {
    expect(parseScheduleDateTime("invalid-date")).toBeNull();
  });
});

describe("normalizeScheduleIdentity", () => {
  it("removes accents and punctuation", () => {
    const key = normalizeScheduleIdentity("Nguyễn Văn A");
    expect(key).toBe("nguyenvana");
  });
});
