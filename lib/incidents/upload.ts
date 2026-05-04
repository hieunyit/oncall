import { IncidentAttachmentKind } from "@/app/generated/prisma/client";
import path from "node:path";
import {
  INCIDENT_EXCEL_EXTENSIONS,
  INCIDENT_EXCEL_MIME_TYPES,
  INCIDENT_IMAGE_EXTENSIONS,
  INCIDENT_IMAGE_MIME_PREFIX,
} from "@/lib/incidents/constants";

export function normalizeIncidentFileName(fileName: string): string {
  const raw = fileName.trim() || "attachment";
  const parsed = path.parse(raw);
  const stem = parsed.name
    .replace(/[^a-zA-Z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "attachment";
  const ext = parsed.ext.toLowerCase().slice(0, 10);
  return `${stem}${ext}`;
}

export function detectIncidentAttachmentKind(
  fileName: string,
  contentType: string
): IncidentAttachmentKind | null {
  const ext = path.extname(fileName).toLowerCase();
  const mime = contentType.toLowerCase();

  if (mime.startsWith(INCIDENT_IMAGE_MIME_PREFIX) || INCIDENT_IMAGE_EXTENSIONS.has(ext)) {
    return IncidentAttachmentKind.IMAGE;
  }

  if (INCIDENT_EXCEL_MIME_TYPES.has(mime) || INCIDENT_EXCEL_EXTENSIONS.has(ext)) {
    return IncidentAttachmentKind.EXCEL;
  }

  return null;
}
