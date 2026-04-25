import { prisma } from "@/lib/prisma";

interface AuditParams {
  actorId?: string;
  entityType: string;
  entityId: string;
  action: string;
  oldValue?: unknown;
  newValue?: unknown;
  ipAddress?: string;
  userAgent?: string;
}

export async function writeAuditLog(params: AuditParams) {
  return prisma.auditLog.create({
    data: {
      actorId: params.actorId ?? null,
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      oldValue: params.oldValue ? (params.oldValue as object) : undefined,
      newValue: params.newValue ? (params.newValue as object) : undefined,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
    },
  });
}
