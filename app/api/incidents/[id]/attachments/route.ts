import { NextRequest } from "next/server";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { IncidentAttachmentKind } from "@/app/generated/prisma/client";
import { badRequest, forbidden, handleError, ok, unauthorized } from "@/lib/api-response";
import { getSessionUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { ensureTeamAccess, getIncidentAccessScope } from "@/lib/incidents/access";
import {
  MAX_INCIDENT_UPLOAD_FILES,
  MAX_INCIDENT_UPLOAD_SIZE_BYTES,
} from "@/lib/incidents/constants";
import { detectIncidentAttachmentKind, normalizeIncidentFileName } from "@/lib/incidents/upload";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getSessionUser();
    if (!user) return unauthorized();

    const { id } = await params;
    const scope = await getIncidentAccessScope(user.id, user.systemRole);

    const incident = await prisma.incident.findUnique({
      where: { id },
      select: { id: true, teamId: true },
    });
    if (!incident) return badRequest("Incident không tồn tại");
    if (!ensureTeamAccess(scope, incident.teamId)) return forbidden();

    const form = await req.formData();
    const files = [
      ...form.getAll("files"),
      form.get("file"),
    ].filter((entry): entry is File => entry instanceof File);

    if (files.length === 0) {
      return badRequest("Vui lòng chọn ít nhất một file");
    }

    if (files.length > MAX_INCIDENT_UPLOAD_FILES) {
      return badRequest(`Chỉ cho phép tối đa ${MAX_INCIDENT_UPLOAD_FILES} file mỗi lần tải`);
    }

    const incidentDir = path.join(process.cwd(), "public", "uploads", "incidents", incident.id);
    await mkdir(incidentDir, { recursive: true });

    const rows: Array<{
      fileName: string;
      storagePath: string;
      contentType: string;
      sizeBytes: number;
      kind: IncidentAttachmentKind;
      uploadedById: string;
    }> = [];

    for (const file of files) {
      if (file.size <= 0) {
        return badRequest(`File \"${file.name}\" trống hoặc không hợp lệ`);
      }

      if (file.size > MAX_INCIDENT_UPLOAD_SIZE_BYTES) {
        return badRequest(
          `File \"${file.name}\" vượt giới hạn ${Math.round(
            MAX_INCIDENT_UPLOAD_SIZE_BYTES / 1024 / 1024
          )}MB`
        );
      }

      const kind = detectIncidentAttachmentKind(file.name, file.type);
      if (!kind) {
        return badRequest(
          `File \"${file.name}\" không hợp lệ. Chỉ chấp nhận ảnh, Excel/CSV, PDF, Word, TXT`
        );
      }

      const normalized = normalizeIncidentFileName(file.name);
      const ext = path.extname(normalized).toLowerCase();
      const diskName = `${Date.now()}-${randomUUID()}${ext}`;
      const diskPath = path.join(incidentDir, diskName);
      const storagePath = `/uploads/incidents/${incident.id}/${diskName}`;

      const arrayBuffer = await file.arrayBuffer();
      await writeFile(diskPath, Buffer.from(arrayBuffer));

      rows.push({
        fileName: normalized,
        storagePath,
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        kind,
        uploadedById: user.id,
      });
    }

    const createdFiles = await prisma.$transaction(
      rows.map((row) =>
        prisma.incidentAttachment.create({
          data: {
            incidentId: incident.id,
            fileName: row.fileName,
            storagePath: row.storagePath,
            contentType: row.contentType,
            sizeBytes: row.sizeBytes,
            kind: row.kind,
            uploadedById: row.uploadedById,
          },
          select: {
            id: true,
            fileName: true,
            storagePath: true,
            contentType: true,
            sizeBytes: true,
            kind: true,
            createdAt: true,
          },
        })
      )
    );

    return ok({ files: createdFiles });
  } catch (error) {
    return handleError(error);
  }
}
