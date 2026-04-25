import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { PolicyForm } from "@/components/policy/policy-form";
import { PublishBatchForm } from "../../teams/[id]/publish-batch-form";
import { BatchList } from "./batch-list";
import { DeletePolicyButton } from "./delete-policy-button";

export default async function PolicyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const { id } = await params;

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, systemRole: true },
  });
  if (!currentUser) redirect("/login");

  const policy = await prisma.rotationPolicy.findUnique({
    where: { id },
    include: {
      team: {
        include: {
          members: {
            include: { user: { select: { id: true, fullName: true, email: true } } },
            orderBy: { order: "asc" },
          },
        },
      },
    },
  });

  if (!policy) notFound();

  const myMembership = policy.team.members.find((m) => m.userId === currentUser.id);
  if (currentUser.systemRole !== "ADMIN" && !myMembership) redirect("/policies");

  const isManager =
    currentUser.systemRole === "ADMIN" || myMembership?.role === "MANAGER";

  const [teams, escalationPolicies] = await Promise.all([
    prisma.team.findMany({
      select: { id: true, name: true },
      where: currentUser.systemRole === "ADMIN" ? {} : { id: policy.teamId },
    }),
    prisma.escalationPolicy.findMany({
      where: { isActive: true },
      select: { id: true, name: true, teamId: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const recentBatches = await prisma.scheduleBatch.findMany({
    where: { policyId: id },
    include: {
      _count: { select: { shifts: { where: { status: { not: "CANCELLED" } } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  const recentShifts = await prisma.shift.findMany({
    where: { policyId: id },
    include: {
      assignee: { select: { fullName: true } },
      confirmation: { select: { status: true } },
    },
    orderBy: { startsAt: "asc" },
    take: 20,
  });

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/policies" className="hover:text-gray-700">Chính sách</Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">{policy.name}</span>
      </div>

      {isManager ? (
        <>
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-2xl font-bold text-gray-900">Chỉnh sửa chính sách</h1>
            <DeletePolicyButton policyId={policy.id} policyName={policy.name} />
          </div>
          <PolicyForm
            teams={teams}
            escalationPolicies={escalationPolicies}
            initialData={{
              id: policy.id,
              name: policy.name,
              teamId: policy.teamId,
              cadence: policy.cadence,
              cronExpression: policy.cronExpression,
              shiftDurationHours: policy.shiftDurationHours,
              handoverOffsetMinutes: policy.handoverOffsetMinutes,
              confirmationDueHours: policy.confirmationDueHours,
              reminderLeadHours: policy.reminderLeadHours,
              maxGenerateWeeks: policy.maxGenerateWeeks,
              escalationPolicyId: policy.escalationPolicyId,
              timeSlots: policy.timeSlots as Array<{ label: string; startHour: number; startMinute: number; endHour: number; endMinute: number }> | null,
            }}
          />
        </>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h1 className="text-xl font-bold text-gray-900">{policy.name}</h1>
          <p className="text-gray-500 mt-1">Nhóm: {policy.team.name}</p>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <Stat label="Chu kỳ" value={policy.cadence} />
            <Stat label="Độ dài ca" value={`${policy.shiftDurationHours}h`} />
            <Stat label="Xác nhận trước" value={`${policy.confirmationDueHours}h`} />
            <Stat label="Nhắc nhở trước" value={policy.reminderLeadHours.map((h) => `${h}h`).join(", ")} />
          </dl>
        </div>
      )}

      {/* Generate shifts */}
      {isManager && (
        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h2 className="font-semibold text-gray-900">Sinh ca trực</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Tạo lịch trực từ hôm nay theo chính sách vòng lặp. Ca đã tồn tại sẽ bỏ qua (idempotent).
              </p>
            </div>
            <PublishBatchForm policyId={policy.id} policyName={policy.name} />
          </div>
        </section>
      )}

      {/* Batch list */}
      <section className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Lô lịch ({recentBatches.length})</h2>
        </div>
        <BatchList batches={recentBatches} />
      </section>

      {/* Shifts table */}
      <section className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Ca trực ({recentShifts.length})</h2>
        </div>
        {recentShifts.length === 0 ? (
          <p className="px-5 py-8 text-center text-gray-400 text-sm">
            Chưa có ca trực nào.{isManager && ' Nhấn "Publish lịch" để sinh ca trực.'}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-gray-500">Bắt đầu</th>
                <th className="text-left px-4 py-2 font-medium text-gray-500">Kết thúc</th>
                <th className="text-left px-4 py-2 font-medium text-gray-500">Người trực</th>
                <th className="text-left px-4 py-2 font-medium text-gray-500">Xác nhận</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {recentShifts.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-2 text-gray-700">{s.startsAt.toLocaleString("vi-VN")}</td>
                  <td className="px-4 py-2 text-gray-700">{s.endsAt.toLocaleString("vi-VN")}</td>
                  <td className="px-4 py-2 font-medium text-gray-900">{s.assignee.fullName}</td>
                  <td className="px-4 py-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                      s.confirmation?.status === "CONFIRMED" ? "bg-green-100 text-green-700" :
                      s.confirmation?.status === "PENDING" ? "bg-yellow-100 text-yellow-700" :
                      "bg-gray-100 text-gray-500"
                    }`}>
                      {s.confirmation?.status ?? "—"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-gray-500">{label}</dt>
      <dd className="font-medium text-gray-900 mt-0.5">{value}</dd>
    </div>
  );
}
