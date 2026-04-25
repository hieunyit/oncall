import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { SystemRole } from "@/app/generated/prisma/client";
import { UserRoleActions } from "./user-role-actions";

export const metadata = { title: "Quản lý người dùng" };

export default async function UsersPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, systemRole: true },
  });

  if (currentUser?.systemRole !== SystemRole.ADMIN) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mb-4">
          <svg className="w-7 h-7 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
          </svg>
        </div>
        <p className="font-medium text-gray-700">Không có quyền truy cập</p>
        <p className="text-sm text-gray-400 mt-1">Chỉ quản trị viên mới có thể xem trang này.</p>
      </div>
    );
  }

  const users = await prisma.user.findMany({
    orderBy: [{ systemRole: "asc" }, { createdAt: "asc" }],
    select: {
      id: true, email: true, fullName: true,
      systemRole: true, isActive: true,
      telegramChatId: true, createdAt: true,
      _count: { select: { teamMembers: true } },
    },
  });

  const admins = users.filter(u => u.systemRole === SystemRole.ADMIN).length;
  const active = users.filter(u => u.isActive).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Người dùng</h1>
        <p className="text-sm text-gray-500 mt-0.5">Quản lý vai trò và trạng thái tài khoản</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Tổng người dùng", value: users.length, cls: "text-blue-700" },
          { label: "Quản trị viên", value: admins, cls: "text-purple-700" },
          { label: "Đang hoạt động", value: active, cls: "text-green-700" },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-200 px-5 py-4">
            <p className="text-xs text-gray-500">{s.label}</p>
            <p className={`text-2xl font-bold mt-1 ${s.cls}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-5 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Người dùng</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Vai trò</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Nhóm</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Telegram</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Trạng thái</th>
              <th className="text-right px-5 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Hành động</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-gray-50/50 transition-colors">
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-semibold text-indigo-600 shrink-0">
                      {user.fullName.split(" ").map((w: string) => w[0]).slice(-2).join("").toUpperCase()}
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{user.fullName}</p>
                      <p className="text-xs text-gray-400">{user.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3.5">
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                    user.systemRole === SystemRole.ADMIN ? "bg-purple-100 text-purple-700" : "bg-gray-100 text-gray-600"
                  }`}>
                    {user.systemRole === SystemRole.ADMIN ? "Admin" : "User"}
                  </span>
                </td>
                <td className="px-4 py-3.5 text-gray-600">{user._count.teamMembers} nhóm</td>
                <td className="px-4 py-3.5">
                  {user.telegramChatId
                    ? <span className="text-xs text-blue-600 font-medium">Đã kết nối</span>
                    : <span className="text-xs text-gray-300">—</span>}
                </td>
                <td className="px-4 py-3.5">
                  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
                    user.isActive ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${user.isActive ? "bg-green-500" : "bg-red-400"}`} />
                    {user.isActive ? "Hoạt động" : "Vô hiệu"}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-right">
                  {user.id !== currentUser?.id && (
                    <UserRoleActions userId={user.id} currentRole={user.systemRole} isActive={user.isActive} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
