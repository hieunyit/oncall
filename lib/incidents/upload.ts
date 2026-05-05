import { IncidentAttachmentKind } from "@/app/generated/prisma/client";
import path from "node:path";
import {
  INCIDENT_EXCEL_EXTENSIONS,
  INCIDENT_EXCEL_MIME_TYPES,
  INCIDENT_IMAGE_EXTENSIONS,
  INCIDENT_IMAGE_MIME_PREFIX,
  INCIDENT_PDF_EXTENSIONS,
  INCIDENT_PDF_MIME_TYPES,
  INCIDENT_TEXT_EXTENSIONS,
  INCIDENT_TEXT_MIME_TYPES,
  INCIDENT_WORD_EXTENSIONS,
  INCIDENT_WORD_MIME_TYPES,
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

  if (INCIDENT_PDF_MIME_TYPES.has(mime) || INCIDENT_PDF_EXTENSIONS.has(ext)) {
    return IncidentAttachmentKind.PDF;
  }

  if (INCIDENT_WORD_MIME_TYPES.has(mime) || INCIDENT_WORD_EXTENSIONS.has(ext)) {
    return IncidentAttachmentKind.WORD;
  }

  if (INCIDENT_TEXT_MIME_TYPES.has(mime) || INCIDENT_TEXT_EXTENSIONS.has(ext)) {
    return IncidentAttachmentKind.TEXT;
  }

  return null;
}

function startsWithSignature(buffer: Buffer, signature: number[]): boolean {
  if (buffer.length < signature.length) return false;
  return signature.every((byte, idx) => buffer[idx] === byte);
}

function isLikelyTextFile(buffer: Buffer): boolean {
  if (buffer.length === 0) return true;
  let controlBytes = 0;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  for (const byte of sample) {
    const isWhitespace = byte === 9 || byte === 10 || byte === 13;
    const isPrintableAscii = byte >= 32 && byte <= 126;
    const isUtf8Lead = byte >= 194 && byte <= 244;
    const isUtf8Trail = byte >= 128 && byte <= 191;
    if (!isWhitespace && !isPrintableAscii && !isUtf8Lead && !isUtf8Trail) {
      controlBytes++;
    }
  }
  return controlBytes / sample.length < 0.1;
}

export function isIncidentAttachmentContentValid(
  kind: IncidentAttachmentKind,
  buffer: Buffer
): boolean {
  if (buffer.length === 0) return false;

  switch (kind) {
    case IncidentAttachmentKind.IMAGE: {
      const isPng = startsWithSignature(buffer, [0x89, 0x50, 0x4e, 0x47]);
      const isJpeg = startsWithSignature(buffer, [0xff, 0xd8, 0xff]);
      const isGif = startsWithSignature(buffer, [0x47, 0x49, 0x46, 0x38]);
      const isWebp =
        startsWithSignature(buffer, [0x52, 0x49, 0x46, 0x46]) &&
        buffer.length > 12 &&
        buffer.toString("ascii", 8, 12) === "WEBP";
      return isPng || isJpeg || isGif || isWebp;
    }
    case IncidentAttachmentKind.PDF:
      return startsWithSignature(buffer, [0x25, 0x50, 0x44, 0x46]);
    case IncidentAttachmentKind.TEXT:
      return isLikelyTextFile(buffer);
    case IncidentAttachmentKind.EXCEL:
    case IncidentAttachmentKind.WORD:
    default:
      // Keep extension + MIME validation for Office formats (legacy binary vs OpenXML ZIP).
      return true;
  }
}
