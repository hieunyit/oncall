import { IncidentSeverity, IncidentStatus } from "@/app/generated/prisma/client";

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  OPEN: "Mới mở",
  INVESTIGATING: "Đang điều tra",
  MITIGATED: "Đã giảm thiểu",
  RESOLVED: "Đã khắc phục",
  CLOSED: "Đóng",
};

export const INCIDENT_SEVERITY_LABELS: Record<IncidentSeverity, string> = {
  LOW: "Thấp",
  MEDIUM: "Trung bình",
  HIGH: "Cao",
  CRITICAL: "Nghiêm trọng",
};

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".bmp",
  ".svg",
]);

const EXCEL_EXTENSIONS = new Set([
  ".xls",
  ".xlsx",
  ".csv",
]);

const IMAGE_MIME_PREFIX = "image/";
const EXCEL_MIME_TYPES = new Set([
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "application/csv",
]);

export const MAX_INCIDENT_UPLOAD_SIZE_BYTES = 15 * 1024 * 1024; // 15MB/file
export const MAX_INCIDENT_UPLOAD_FILES = 6;

export function toIncidentDayKey(date: Date, tz = "Asia/Ho_Chi_Minh"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export const INCIDENT_IMAGE_EXTENSIONS = IMAGE_EXTENSIONS;
export const INCIDENT_EXCEL_EXTENSIONS = EXCEL_EXTENSIONS;
export const INCIDENT_IMAGE_MIME_PREFIX = IMAGE_MIME_PREFIX;
export const INCIDENT_EXCEL_MIME_TYPES = EXCEL_MIME_TYPES;
