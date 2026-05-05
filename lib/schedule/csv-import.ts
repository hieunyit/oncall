export type ScheduleCsvField =
  | "startDate"
  | "startTime"
  | "endDate"
  | "endTime"
  | "assignee"
  | "backup"
  | "notes";

export type ScheduleCsvRow = {
  line: number;
  startDateText: string;
  startTimeText: string;
  endDateText: string;
  endTimeText: string;
  assigneeText: string;
  backupText: string | null;
  notes: string | null;
};

export type ScheduleCsvError = {
  line: number;
  field: ScheduleCsvField | "header" | "file";
  message: string;
};

type ParseCsvResult = {
  rows: string[][];
  unclosedQuote: boolean;
};

const REQUIRED_FIELDS: ScheduleCsvField[] = [
  "startDate",
  "startTime",
  "endDate",
  "endTime",
  "assignee",
];

const HEADER_ALIASES: Record<ScheduleCsvField, string[]> = {
  startDate: [
    "startdate",
    "ngaybatdau",
    "batdaungay",
    "ngaybatdauca",
    "startday",
  ],
  startTime: [
    "starttime",
    "giobatdau",
    "batdaugio",
    "giobatdauca",
    "starthour",
  ],
  endDate: [
    "enddate",
    "ngayketthuc",
    "ketthucngay",
    "ngayketthucca",
    "endday",
  ],
  endTime: [
    "endtime",
    "gioketthuc",
    "ketthucgio",
    "gioketthucca",
    "endhour",
  ],
  assignee: [
    "assignee",
    "assigneeemail",
    "email",
    "emailassignee",
    "nguoitruc",
    "nguoiphutrach",
  ],
  backup: [
    "backup",
    "backupemail",
    "emailbackup",
    "duphong",
    "nguoiduphong",
  ],
  notes: ["notes", "note", "ghichu"],
};

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function isRowEmpty(row: string[]): boolean {
  return row.every((cell) => cell.trim() === "");
}

function parseCsv(content: string): ParseCsvResult {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];

    if (char === '"') {
      if (inQuotes && content[i + 1] === '"') {
        currentCell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      currentRow.push(currentCell);
      currentCell = "";
      continue;
    }

    if (char === "\n" && !inQuotes) {
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = "";
      continue;
    }

    if (char !== "\r") {
      currentCell += char;
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  return { rows, unclosedQuote: inQuotes };
}

function detectHeaderField(rawHeader: string): ScheduleCsvField | null {
  const normalizedHeader = normalizeText(rawHeader);
  if (!normalizedHeader) return null;

  const entries = Object.entries(HEADER_ALIASES) as Array<[ScheduleCsvField, string[]]>;
  for (const [field, aliases] of entries) {
    if (aliases.some((alias) => normalizeText(alias) === normalizedHeader)) {
      return field;
    }
  }
  return null;
}

export function parseScheduleDate(value: string): Date | null {
  const input = value.trim();
  if (!input) return null;

  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/;
  const ymdMatch = input.match(ymd);
  if (ymdMatch) {
    const [, year, month, day] = ymdMatch;
    const date = new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/;
  const dmyMatch = input.match(dmy);
  if (dmyMatch) {
    const [, day, month, year] = dmyMatch;
    const date = new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

export function parseScheduleTime(value: string): { hour: number; minute: number; second: number } | null {
  const input = value.trim();
  if (!input) return null;

  const timePattern = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;
  const match = input.match(timePattern);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? "0");

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    return null;
  }

  return { hour, minute, second };
}

export function combineScheduleDateTime(dateText: string, timeText: string): Date | null {
  const date = parseScheduleDate(dateText);
  const time = parseScheduleTime(timeText);
  if (!date || !time) return null;

  const combined = new Date(date);
  combined.setHours(time.hour, time.minute, time.second, 0);
  return Number.isNaN(combined.getTime()) ? null : combined;
}

export function parseScheduleCsv(content: string): {
  rows: ScheduleCsvRow[];
  errors: ScheduleCsvError[];
} {
  const normalizedContent = content.replace(/^\uFEFF/, "");
  const { rows: rawRows, unclosedQuote } = parseCsv(normalizedContent);
  const errors: ScheduleCsvError[] = [];

  if (unclosedQuote) {
    errors.push({
      line: 1,
      field: "file",
      message: "CSV không hợp lệ: thiếu dấu nháy đóng (\")",
    });
    return { rows: [], errors };
  }

  const firstRow = rawRows[0];
  if (!firstRow || isRowEmpty(firstRow)) {
    errors.push({
      line: 1,
      field: "file",
      message: "CSV không có dữ liệu",
    });
    return { rows: [], errors };
  }

  const fieldIndexes: Partial<Record<ScheduleCsvField, number>> = {};
  firstRow.forEach((header, index) => {
    const field = detectHeaderField(header);
    if (!field) return;
    if (fieldIndexes[field] === undefined) {
      fieldIndexes[field] = index;
    }
  });

  for (const required of REQUIRED_FIELDS) {
    if (fieldIndexes[required] === undefined) {
      errors.push({
        line: 1,
        field: "header",
        message: `Thiếu cột bắt buộc: ${required}`,
      });
    }
  }

  if (errors.length > 0) return { rows: [], errors };

  const parsedRows: ScheduleCsvRow[] = [];
  for (let index = 1; index < rawRows.length; index += 1) {
    const row = rawRows[index];
    if (!row || isRowEmpty(row)) continue;

    const line = index + 1;
    const startDateText = (row[fieldIndexes.startDate!] ?? "").trim();
    const startTimeText = (row[fieldIndexes.startTime!] ?? "").trim();
    const endDateText = (row[fieldIndexes.endDate!] ?? "").trim();
    const endTimeText = (row[fieldIndexes.endTime!] ?? "").trim();
    const assigneeText = (row[fieldIndexes.assignee!] ?? "").trim();
    const backupTextRaw =
      fieldIndexes.backup !== undefined ? (row[fieldIndexes.backup] ?? "").trim() : "";
    const notesRaw =
      fieldIndexes.notes !== undefined ? (row[fieldIndexes.notes] ?? "").trim() : "";

    if (!startDateText) {
      errors.push({ line, field: "startDate", message: "Thiếu startDate" });
    }
    if (!startTimeText) {
      errors.push({ line, field: "startTime", message: "Thiếu startTime" });
    }
    if (!endDateText) {
      errors.push({ line, field: "endDate", message: "Thiếu endDate" });
    }
    if (!endTimeText) {
      errors.push({ line, field: "endTime", message: "Thiếu endTime" });
    }
    if (!assigneeText) {
      errors.push({ line, field: "assignee", message: "Thiếu assignee" });
    }

    parsedRows.push({
      line,
      startDateText,
      startTimeText,
      endDateText,
      endTimeText,
      assigneeText,
      backupText: backupTextRaw || null,
      notes: notesRaw || null,
    });
  }

  if (parsedRows.length === 0) {
    errors.push({
      line: 1,
      field: "file",
      message: "CSV không có dòng dữ liệu hợp lệ",
    });
  }

  return {
    rows: errors.length > 0 ? [] : parsedRows,
    errors,
  };
}

export function normalizeScheduleIdentity(value: string): string {
  return normalizeText(value);
}
