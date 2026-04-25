import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { ConfirmationStatus } from "@/app/generated/prisma/client";
import { ConfirmActionButtons } from "./confirm-action-buttons";

export default async function ConfirmPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const confirmation = await prisma.shiftConfirmation.findUnique({
    where: { token },
    include: {
      shift: {
        include: {
          assignee: { select: { fullName: true } },
          policy: { select: { name: true } },
        },
      },
    },
  });

  if (!confirmation) notFound();

  const { shift } = confirmation;
  const isExpired = new Date() > confirmation.dueAt;
  const alreadyResponded = confirmation.status !== ConfirmationStatus.PENDING;

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm w-full max-w-md p-8 space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">Xác nhận ca trực</h1>
          <p className="text-gray-500 mt-1">{shift.policy.name}</p>
        </div>

        <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
          <Row label="Người trực" value={shift.assignee.fullName} />
          <Row
            label="Bắt đầu"
            value={format(shift.startsAt, "EEEE, dd/MM/yyyy HH:mm", { locale: vi })}
          />
          <Row
            label="Kết thúc"
            value={format(shift.endsAt, "dd/MM/yyyy HH:mm", { locale: vi })}
          />
          <Row
            label="Hạn xác nhận"
            value={format(confirmation.dueAt, "dd/MM/yyyy HH:mm", { locale: vi })}
          />
        </div>

        {alreadyResponded ? (
          <StatusMessage status={confirmation.status} />
        ) : isExpired ? (
          <div className="text-center py-4 text-red-600 font-medium">
            ⏰ Yêu cầu xác nhận này đã hết hạn.
          </div>
        ) : (
          <ConfirmActionButtons token={token} />
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900">{value}</span>
    </div>
  );
}

function StatusMessage({ status }: { status: ConfirmationStatus }) {
  if (status === ConfirmationStatus.CONFIRMED) {
    return (
      <div className="text-center py-4 text-green-600 font-medium">
        ✅ Bạn đã xác nhận ca trực này.
      </div>
    );
  }
  if (status === ConfirmationStatus.DECLINED) {
    return (
      <div className="text-center py-4 text-red-600 font-medium">
        ❌ Bạn đã từ chối ca trực này.
      </div>
    );
  }
  return null;
}
