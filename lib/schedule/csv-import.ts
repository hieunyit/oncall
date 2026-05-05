export type ScheduleCsvField = "startsAt" | "endsAt" | "assignee" | "backup" | "notes";

export type ScheduleCsvRow = {
  line: number;
  startsAtText: string;
  endsAtText: string;
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

const REQUIRED_FIELDS: ScheduleCsvField[] = ["startsAt", "endsAt", "assignee"];

const HEADER_ALIASES: Record<ScheduleCsvField, string[]> = {
  startsAt: [
    "startsat",
    "start",
    "from",
    "batdau",
    "thoigianbatdau",
    "gio bat dau",
    "gio batdau",
  ],
  endsAt: [
    "endsat",
    "end",
    "to",
    "ketthuc",
    "thoigianketthuc",
    "gio ket thuc",
    "gio ketthuc",
  ],
  assignee: [
    "assignee",
    "assigneeemail",
    "email",
    "emailassignee",
    "nguoitruc",
    "nguoitruc",
    "nguoi truc",
  ],
  backup: [
    "backup",
    "backupemail",
    "emailbackup",
    "duphong",
    "nguoiduphong",
    "nguoi du phong",
  ],
  notes: ["notes", "note", "ghichu", "ghi chu"],
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

export function parseScheduleDateTime(value: string): Date | null {
  const input = value.trim();
  if (!input) return null;

  const isoLike = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?([.]\d{1,3})?([zZ]|[+-]\d{2}:\d{2})?$/;
  if (isoLike.test(input)) {
    const normalized = input.includes(" ") ? input.replace(" ", "T") : input;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const ymd = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;
  const ymdMatch = input.match(ymd);
  if (ymdMatch) {
    const [, year, month, day, hour, minute, second] = ymdMatch;
    return new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second ?? "0")
    );
  }

  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;
  const dmyMatch = input.match(dmy);
  if (dmyMatch) {
    const [, day, month, year, hour, minute, second] = dmyMatch;
    return new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second ?? "0")
    );
  }

  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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
    const startsAtText = (row[fieldIndexes.startsAt!] ?? "").trim();
    const endsAtText = (row[fieldIndexes.endsAt!] ?? "").trim();
    const assigneeText = (row[fieldIndexes.assignee!] ?? "").trim();
    const backupTextRaw =
      fieldIndexes.backup !== undefined ? (row[fieldIndexes.backup] ?? "").trim() : "";
    const notesRaw =
      fieldIndexes.notes !== undefined ? (row[fieldIndexes.notes] ?? "").trim() : "";

    if (!startsAtText) {
      errors.push({ line, field: "startsAt", message: "Thiếu startsAt" });
    }
    if (!endsAtText) {
      errors.push({ line, field: "endsAt", message: "Thiếu endsAt" });
    }
    if (!assigneeText) {
      errors.push({ line, field: "assignee", message: "Thiếu assignee" });
    }

    parsedRows.push({
      line,
      startsAtText,
      endsAtText,
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
