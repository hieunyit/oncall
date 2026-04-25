import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { SystemRole } from "@/app/generated/prisma/client";

export default async function UsersPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { systemRole: true },
  });

  if (currentUser?.systemRole !== SystemRole.ADMIN) {
    return (
      <div className="text-center py-12 text-gray-500">
        Chỉ ADMIN mới có thể xem trang này.
      </div>
    );
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      fullName: true,
      systemRole: true,
      isActive: true,
      timezone: true,
      createdAt: true,
      _count: { select: { teamMembers: true } },
    },
    take: 50,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Người dùng</h1>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Tên</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Email</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Vai trò</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Nhóm</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Trạng thái</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{user.fullName}</td>
                <td className="px-4 py-3 text-gray-600">{user.email}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                      user.systemRole === SystemRole.ADMIN
                        ? "bg-purple-100 text-purple-700"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {user.systemRole}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-600">{user._count.teamMembers} nhóm</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                      user.isActive
                        ? "bg-green-100 text-green-700"
                        : "bg-red-100 text-red-700"
                    }`}
                  >
                    {user.isActive ? "Hoạt động" : "Vô hiệu"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
