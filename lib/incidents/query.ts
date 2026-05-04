import { Prisma } from "@/app/generated/prisma/client";

export const incidentInclude = {
  team: { select: { id: true, name: true } },
  policy: { select: { id: true, name: true } },
  shift: { select: { id: true, startsAt: true, endsAt: true } },
  createdBy: { select: { id: true, fullName: true } },
  assignee: { select: { id: true, fullName: true } },
  attachments: {
    orderBy: { createdAt: "asc" as const },
    select: {
      id: true,
      fileName: true,
      storagePath: true,
      contentType: true,
      sizeBytes: true,
      kind: true,
      createdAt: true,
      uploadedBy: { select: { id: true, fullName: true } },
    },
  },
  lifecycleEvents: {
    orderBy: { createdAt: "asc" as const },
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      note: true,
      createdAt: true,
      changedBy: { select: { id: true, fullName: true } },
    },
  },
} satisfies Prisma.IncidentInclude;

export type IncidentWithRelations = Prisma.IncidentGetPayload<{
  include: typeof incidentInclude;
}>;
