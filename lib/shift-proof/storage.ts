import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { prisma } from "@/lib/prisma";

export type ShiftProofKind = "CHECK_IN" | "CHECK_OUT";

export const MAX_SHIFT_PROOF_UPLOAD_SIZE_BYTES = 15 * 1024 * 1024;

export interface SaveShiftProofInput {
  shiftId: string;
  policyId: string;
  userId: string;
  kind: ShiftProofKind;
  fileName: string;
  contentType?: string | null;
  fileBuffer: Buffer;
  telegramFileId?: string | null;
  telegramMessageId?: number | null;
}

export interface SavedShiftProof {
  id: string;
  storagePath: string;
  fileName: string;
  sizeBytes: number;
}

function startsWithSignature(buffer: Buffer, signature: number[]): boolean {
  if (buffer.length < signature.length) return false;
  return signature.every((byte, index) => buffer[index] === byte);
}

function detectImageType(
  fileName: string,
  contentType: string | null | undefined,
  fileBuffer: Buffer
): { extension: string; contentType: string } | null {
  const ext = path.extname(fileName).toLowerCase();
  const mime = (contentType ?? "").toLowerCase();

  const isPng = startsWithSignature(fileBuffer, [0x89, 0x50, 0x4e, 0x47]);
  if (isPng) return { extension: ".png", contentType: "image/png" };

  const isJpeg = startsWithSignature(fileBuffer, [0xff, 0xd8, 0xff]);
  if (isJpeg) return { extension: ".jpg", contentType: "image/jpeg" };

  const isGif = startsWithSignature(fileBuffer, [0x47, 0x49, 0x46, 0x38]);
  if (isGif) return { extension: ".gif", contentType: "image/gif" };

  const isWebp =
    startsWithSignature(fileBuffer, [0x52, 0x49, 0x46, 0x46]) &&
    fileBuffer.length > 12 &&
    fileBuffer.toString("ascii", 8, 12) === "WEBP";
  if (isWebp) return { extension: ".webp", contentType: "image/webp" };

  const allowedExt = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
  const allowedMime = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
  if (allowedExt.has(ext) && allowedMime.has(mime)) {
    return {
      extension: ext === ".jpeg" ? ".jpg" : ext,
      contentType: mime,
    };
  }

  return null;
}

function normalizeFileName(fileName: string): string {
  const raw = fileName.trim() || "shift-proof";
  const parsed = path.parse(raw);
  const stem = parsed.name
    .replace(/[^a-zA-Z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "shift-proof";
  const ext = parsed.ext.toLowerCase().slice(0, 10);
  return `${stem}${ext}`;
}

export async function saveShiftProof(input: SaveShiftProofInput): Promise<SavedShiftProof> {
  if (input.fileBuffer.length <= 0) {
    throw new Error("Ảnh chứng thực trống");
  }
  if (input.fileBuffer.length > MAX_SHIFT_PROOF_UPLOAD_SIZE_BYTES) {
    throw new Error("Ảnh chứng thực vượt quá 15MB");
  }

  const normalizedFileName = normalizeFileName(input.fileName);
  const imageType = detectImageType(
    normalizedFileName,
    input.contentType,
    input.fileBuffer
  );
  if (!imageType) {
    throw new Error("Ảnh chứng thực không đúng định dạng PNG/JPG/GIF/WEBP");
  }

  const dirPath = path.join(process.cwd(), "public", "uploads", "shift-proofs", input.shiftId);
  await mkdir(dirPath, { recursive: true });

  const diskFile = `${Date.now()}-${randomUUID()}${imageType.extension}`;
  const diskPath = path.join(dirPath, diskFile);
  const storagePath = `/uploads/shift-proofs/${input.shiftId}/${diskFile}`;

  await writeFile(diskPath, input.fileBuffer);

  const rows = await prisma.$queryRaw<Array<{ id: string; storage_path: string }>>`
    INSERT INTO shift_verification_photos (
      shift_id,
      policy_id,
      user_id,
      kind,
      source,
      file_name,
      storage_path,
      content_type,
      size_bytes,
      telegram_file_id,
      telegram_message_id
    ) VALUES (
      ${input.shiftId}::uuid,
      ${input.policyId}::uuid,
      ${input.userId}::uuid,
      ${input.kind},
      ${"TELEGRAM"},
      ${normalizedFileName},
      ${storagePath},
      ${imageType.contentType},
      ${input.fileBuffer.length},
      ${input.telegramFileId ?? null},
      ${input.telegramMessageId ?? null}
    )
    RETURNING id::text, storage_path
  `;

  const inserted = rows[0];
  if (!inserted) {
    throw new Error("Không thể lưu metadata ảnh chứng thực");
  }

  return {
    id: inserted.id,
    storagePath: inserted.storage_path,
    fileName: normalizedFileName,
    sizeBytes: input.fileBuffer.length,
  };
}

export async function hasShiftProof(input: {
  shiftId: string;
  userId: string;
  kind: ShiftProofKind;
}): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<Array<{ found: number }>>`
      SELECT 1 AS found
      FROM shift_verification_photos
      WHERE shift_id = ${input.shiftId}::uuid
        AND user_id = ${input.userId}::uuid
        AND kind = ${input.kind}
      LIMIT 1
    `;
    return rows.length > 0;
  } catch {
    return false;
  }
}
