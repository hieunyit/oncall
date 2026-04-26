import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { NotificationUrgency } from "@/app/generated/prisma/client";
import { ProfileForm } from "./profile-form";
import { NotificationRulesForm } from "./notification-rules-form";

export const metadata = { title: "Hồ sơ & Cài đặt" };

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: {
      id: true,
      email: true,
      fullName: true,
      timezone: true,
      telegramChatId: true,
      teamsConversationId: true,
      phone: true,
      systemRole: true,
      createdAt: true,
      teamMembers: {
        select: {
          role: true,
          team: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!user) redirect("/login");

  const notificationRules = await prisma.userNotificationRule.findMany({
    where: { userId: user.id },
    orderBy: [{ urgency: "asc" }, { stepOrder: "asc" }],
  });

  const defaultRules = notificationRules.filter((r) => r.urgency === NotificationUrgency.DEFAULT);
  const importantRules = notificationRules.filter((r) => r.urgency === NotificationUrgency.IMPORTANT);

  const profileUser = {
    ...user,
    telegramChatId: user.telegramChatId?.toString() ?? null,
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Hồ sơ & Cài đặt</h1>
        <p className="text-sm text-gray-500 mt-1">Quản lý thông tin cá nhân và kết nối thông báo</p>
      </div>

      {/* Profile card */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="bg-gradient-to-r from-indigo-500 to-indigo-600 px-6 py-8">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur flex items-center justify-center text-2xl font-bold text-white shrink-0">
              {user.fullName.split(" ").map(w => w[0]).slice(-2).join("").toUpperCase()}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">{user.fullName}</h2>
              <p className="text-indigo-200 text-sm">{user.email}</p>
              <span className={`mt-1 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                user.systemRole === "ADMIN"
                  ? "bg-white/20 text-white"
                  : "bg-white/10 text-indigo-100"
              }`}>
                {user.systemRole === "ADMIN" ? "Quản trị viên" : "Người dùng"}
              </span>
            </div>
          </div>
        </div>
        <ProfileForm user={profileUser} />
      </div>

      {/* Notification policy */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="font-medium text-gray-900">Chính sách thông báo</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Cấu hình kênh và thứ tự nhận thông báo theo mức độ ưu tiên.
            Cột "trễ" là số phút chờ bước trước trước khi chuyển sang bước này.
          </p>
        </div>
        <NotificationRulesForm defaultRules={defaultRules} importantRules={importantRules} />
      </div>

      {/* Teams */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="font-medium text-gray-900">Nhóm của bạn</h3>
        </div>
        {user.teamMembers.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-gray-400">Bạn chưa thuộc nhóm nào.</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {user.teamMembers.filter((m) => m.team != null).map(({ team, role }) => (
              <div key={team.id} className="px-5 py-3.5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600 font-semibold text-sm shrink-0">
                    {team.name[0]}
                  </div>
                  <p className="text-sm font-medium text-gray-900">{team.name}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                  role === "MANAGER" ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-600"
                }`}>
                  {role === "MANAGER" ? "Quản lý" : "Thành viên"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Account info */}
      <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
        <h3 className="font-medium text-gray-900 mb-3">Thông tin tài khoản</h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-gray-400 text-xs">Email</p>
            <p className="text-gray-700 font-medium mt-0.5">{user.email}</p>
          </div>
          <div>
            <p className="text-gray-400 text-xs">Tham gia từ</p>
            <p className="text-gray-700 font-medium mt-0.5">
              {new Date(user.createdAt).toLocaleDateString("vi-VN")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
