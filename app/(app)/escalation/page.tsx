import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { EscalationPolicyCard } from "./escalation-policy-card";

export const metadata = { title: "Escalation Chains" };

export default async function EscalationPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, systemRole: true },
  });
  if (!currentUser) redirect("/login");

  const policies = await prisma.escalationPolicy.findMany({
    include: {
      team: { select: { id: true, name: true } },
      rules: { orderBy: { stepOrder: "asc" } },
      rotationPolicies: { select: { id: true, name: true } },
    },
    orderBy: [{ team: { name: "asc" } }, { name: "asc" }],
  });

  const teams = await prisma.team.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const isAdmin = currentUser.systemRole === "ADMIN";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Escalation Chains</h1>
          <p className="text-sm text-gray-500 mt-1">
            Chuỗi leo thang: tự động thông báo đến backup / manager nếu primary không phản hồi.
          </p>
        </div>
        {isAdmin && (
          <Link
            href="/escalation/new"
            className="px-3.5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
          >
            + Tạo mới
          </Link>
        )}
      </div>

      {policies.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-16 text-center">
          <p className="text-gray-400 text-sm">Chưa có escalation chain nào.</p>
          {isAdmin && (
            <Link href="/escalation/new" className="mt-3 inline-block text-sm text-indigo-600 hover:text-indigo-700">
              Tạo chain đầu tiên →
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {policies.map((policy) => (
            <EscalationPolicyCard key={policy.id} policy={policy} isAdmin={isAdmin} />
          ))}
        </div>
      )}
    </div>
  );
}
