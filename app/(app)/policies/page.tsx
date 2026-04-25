import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function PoliciesPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, systemRole: true },
  });
  if (!currentUser) redirect("/login");

  const policies = await prisma.rotationPolicy.findMany({
    where:
      currentUser.systemRole === "ADMIN"
        ? { isActive: true }
        : {
            isActive: true,
            team: { members: { some: { userId: currentUser.id } } },
          },
    include: {
      team: { select: { id: true, name: true } },
      _count: { select: { shifts: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const CADENCE_LABEL: Record<string, string> = {
    DAILY: "Hàng ngày",
    WEEKLY: "Hàng tuần",
    CUSTOM_CRON: "Tùy chỉnh",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Chính sách xoay vòng</h1>
        <Link
          href="/policies/new"
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
        >
          + Tạo chính sách
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Tên</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Nhóm</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Chu kỳ</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Độ dài ca</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Số ca</th>
              <th className="w-16" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {policies.map((policy) => (
              <tr key={policy.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{policy.name}</td>
                <td className="px-4 py-3">
                  <Link href={`/teams/${policy.team.id}`} className="text-blue-600 hover:underline">
                    {policy.team.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-gray-600">
                  {CADENCE_LABEL[policy.cadence] ?? policy.cadence}
                </td>
                <td className="px-4 py-3 text-gray-600">{policy.shiftDurationHours}h</td>
                <td className="px-4 py-3 text-gray-600">{policy._count.shifts}</td>
                <td className="px-4 py-3">
                  <Link href={`/policies/${policy.id}`} className="text-blue-600 hover:underline text-xs">
                    Chi tiết
                  </Link>
                </td>
              </tr>
            ))}
            {policies.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  Chưa có chính sách xoay vòng nào.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
