import "dotenv/config";
import {
  BatchStatus,
  ShiftStatus,
  SwapStatus,
  PrismaClient,
} from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

function createPrismaClient() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
  });
  return new PrismaClient({ adapter });
}

const prisma = createPrismaClient();

type CleanupResult = {
  inactivePolicies: number;
  candidateShifts: number;
  cancelledSwaps: number;
  deletedConfirmations: number;
  deletedTasks: number;
  deletedShifts: number;
  partialBatches: number;
  deletedEmptyBatches: number;
};

function isExecuteMode() {
  return process.argv.includes("--execute");
}

async function main() {
  const execute = isExecuteMode();
  const now = new Date();

  const inactivePolicies = await prisma.rotationPolicy.findMany({
    where: { isActive: false },
    select: { id: true, name: true },
  });
  const inactivePolicyIds = inactivePolicies.map((policy) => policy.id);

  if (inactivePolicyIds.length === 0) {
    console.log("Không có policy nào đang isActive=false. Không cần dọn.");
    return;
  }

  const danglingShifts = await prisma.shift.findMany({
    where: {
      policyId: { in: inactivePolicyIds },
      status: {
        in: [
          ShiftStatus.DRAFT,
          ShiftStatus.PUBLISHED,
          ShiftStatus.ACTIVE,
          ShiftStatus.CANCELLED,
        ],
      },
      OR: [
        { endsAt: { gte: now } },
        { status: { in: [ShiftStatus.DRAFT, ShiftStatus.PUBLISHED, ShiftStatus.ACTIVE] } },
      ],
    },
    select: {
      id: true,
      policyId: true,
      status: true,
      startsAt: true,
      endsAt: true,
    },
    orderBy: { startsAt: "asc" },
  });

  const shiftIds = danglingShifts.map((shift) => shift.id);

  const dryRun: CleanupResult = {
    inactivePolicies: inactivePolicyIds.length,
    candidateShifts: shiftIds.length,
    cancelledSwaps: 0,
    deletedConfirmations: 0,
    deletedTasks: 0,
    deletedShifts: 0,
    partialBatches: 0,
    deletedEmptyBatches: 0,
  };

  console.log("=== PREVIEW DỌN DỮ LIỆU DANG DỞ ===");
  console.log(`Policy inactive: ${dryRun.inactivePolicies}`);
  console.log(`Ca dang dở cần dọn: ${dryRun.candidateShifts}`);

  if (danglingShifts.length > 0) {
    const sample = danglingShifts.slice(0, 10);
    console.log("Mẫu ca sẽ dọn (tối đa 10):");
    for (const shift of sample) {
      console.log(
        `- ${shift.id} | policy=${shift.policyId} | ${shift.status} | ${shift.startsAt.toISOString()} -> ${shift.endsAt.toISOString()}`
      );
    }
  }

  if (!execute) {
    console.log("Chưa thực thi. Thêm --execute để dọn thật.");
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    let cancelledSwaps = 0;
    let deletedConfirmations = 0;
    let deletedTasks = 0;
    let deletedShifts = 0;
    let partialBatches = 0;
    let deletedEmptyBatches = 0;

    if (shiftIds.length > 0) {
      const swapUpdate = await tx.swapRequest.updateMany({
        where: {
          status: { in: [SwapStatus.REQUESTED, SwapStatus.ACCEPTED_BY_TARGET] },
          OR: [{ originalShiftId: { in: shiftIds } }, { targetShiftId: { in: shiftIds } }],
        },
        data: { status: SwapStatus.CANCELLED, version: { increment: 1 } },
      });
      cancelledSwaps = swapUpdate.count;

      const deletedConfirm = await tx.shiftConfirmation.deleteMany({
        where: { shiftId: { in: shiftIds } },
      });
      deletedConfirmations = deletedConfirm.count;

      const deletedTask = await tx.shiftTask.deleteMany({
        where: { shiftId: { in: shiftIds } },
      });
      deletedTasks = deletedTask.count;

      const deletedShift = await tx.shift.deleteMany({
        where: { id: { in: shiftIds } },
      });
      deletedShifts = deletedShift.count;
    }

    const partialBatchIds = (
      await tx.scheduleBatch.findMany({
        where: {
          policyId: { in: inactivePolicyIds },
          status: BatchStatus.PUBLISHED,
          shifts: { some: { status: { in: [ShiftStatus.ACTIVE, ShiftStatus.COMPLETED] } } },
        },
        select: { id: true },
      })
    ).map((batch) => batch.id);

    if (partialBatchIds.length > 0) {
      const partialUpdated = await tx.scheduleBatch.updateMany({
        where: { id: { in: partialBatchIds } },
        data: { status: BatchStatus.PARTIAL },
      });
      partialBatches = partialUpdated.count;
    }

    const emptyBatchIds = (
      await tx.scheduleBatch.findMany({
        where: {
          policyId: { in: inactivePolicyIds },
          shifts: { none: {} },
        },
        select: { id: true },
      })
    ).map((batch) => batch.id);

    if (emptyBatchIds.length > 0) {
      const emptyDeleted = await tx.scheduleBatch.deleteMany({
        where: { id: { in: emptyBatchIds } },
      });
      deletedEmptyBatches = emptyDeleted.count;
    }

    return {
      inactivePolicies: inactivePolicyIds.length,
      candidateShifts: shiftIds.length,
      cancelledSwaps,
      deletedConfirmations,
      deletedTasks,
      deletedShifts,
      partialBatches,
      deletedEmptyBatches,
    } satisfies CleanupResult;
  });

  console.log("=== KẾT QUẢ DỌN DỮ LIỆU ===");
  console.log(`Policy inactive: ${result.inactivePolicies}`);
  console.log(`Ca dang dở đã dọn: ${result.deletedShifts}/${result.candidateShifts}`);
  console.log(`Swap mở đã hủy: ${result.cancelledSwaps}`);
  console.log(`Confirmations đã xóa: ${result.deletedConfirmations}`);
  console.log(`Checklist tasks đã xóa: ${result.deletedTasks}`);
  console.log(`Batch chuyển PARTIAL: ${result.partialBatches}`);
  console.log(`Batch rỗng đã xóa: ${result.deletedEmptyBatches}`);
}

main()
  .catch((error) => {
    console.error("Dọn dữ liệu thất bại:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
