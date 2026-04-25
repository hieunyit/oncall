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

  const CADENCE_COLOR: Record<string, string> = {
    DAILY: "bg-blue-100 text-blue-700",
    WEEKLY: "bg-indigo-100 text-indigo-700",
    CUSTOM_CRON: "bg-purple-100 text-purple-700",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Chính sách xoay vòng</h1>
          <p className="text-sm text-gray-500 mt-0.5">{policies.length} chính sách đang hoạt động</p>
        </div>
        <Link
          href="/policies/new"
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
        >
          + Tạo chính sách
        </Link>
      </div>

      {policies.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-16 text-center">
          <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <p className="text-gray-400 text-sm">Chưa có chính sách xoay vòng nào.</p>
          <Link href="/policies/new" className="mt-3 inline-block text-sm text-indigo-600 hover:text-indigo-700">
            Tạo chính sách đầu tiên →
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {policies.map((policy) => (
            <div
              key={policy.id}
              className="bg-white rounded-xl border border-gray-200 p-5 hover:border-indigo-300 hover:shadow-sm transition-all flex flex-col gap-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    href={`/policies/${policy.id}`}
                    className="font-semibold text-gray-900 hover:text-indigo-700 transition-colors line-clamp-1"
                  >
                    {policy.name}
                  </Link>
                  <Link
                    href={`/teams/${policy.team.id}`}
                    className="text-xs text-indigo-600 hover:underline mt-0.5 inline-block"
                  >
                    {policy.team.name}
                  </Link>
                </div>
                <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full shrink-0">
                  {policy._count.shifts} ca
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${CADENCE_COLOR[policy.cadence] ?? "bg-gray-100 text-gray-600"}`}>
                  {CADENCE_LABEL[policy.cadence] ?? policy.cadence}
                </span>
                <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-teal-50 text-teal-700">
                  {policy.shiftDurationHours}h / ca
                </span>
              </div>

              <div className="pt-1 border-t border-gray-50 flex items-center justify-between">
                <span className="text-xs text-gray-400">{policy._count.shifts} ca đã tạo</span>
                <Link
                  href={`/policies/${policy.id}`}
                  className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
                >
                  Chi tiết →
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
