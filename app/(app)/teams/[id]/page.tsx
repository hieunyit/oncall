import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { TeamMemberActions } from "./team-member-actions";
import { AddMemberForm } from "./add-member-form";
import { PublishBatchForm } from "./publish-batch-form";
import { NotificationChannels } from "./notification-channels";
import { DeleteTeamButton } from "./delete-team-button";

export default async function TeamDetailPage({
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

  const team = await prisma.team.findUnique({
    where: { id },
    include: {
      members: {
        include: {
          user: { select: { id: true, fullName: true, email: true, isActive: true, timezone: true } },
        },
        orderBy: { order: "asc" },
      },
      rotationPolicies: {
        where: { isActive: true },
        orderBy: { createdAt: "desc" },
      },
      notificationChannels: {
        orderBy: [{ type: "asc" }, { name: "asc" }],
      },
    },
  });

  if (!team) notFound();

  // Check access: admin or team member
  const myMembership = team.members.find((m) => m.userId === currentUser.id);
  if (currentUser.systemRole !== "ADMIN" && !myMembership) {
    redirect("/teams");
  }

  const isManager =
    currentUser.systemRole === "ADMIN" || myMembership?.role === "MANAGER";

  // All users for add-member dropdown (not already in team)
  const teamMemberIds = team.members.map((m) => m.userId);
  const allUsers = isManager
    ? await prisma.user.findMany({
        where: { isActive: true, id: { notIn: teamMemberIds } },
        select: { id: true, fullName: true, email: true },
        orderBy: { fullName: "asc" },
      })
    : [];

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/teams" className="hover:text-gray-700">Nhóm</Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">{team.name}</span>
      </div>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{team.name}</h1>
          {team.description && (
            <p className="text-gray-500 mt-1">{team.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {currentUser.systemRole === "ADMIN" && (
            <DeleteTeamButton teamId={id} teamName={team.name} />
          )}
          {isManager && (
            <Link
              href={`/policies/new?teamId=${id}`}
              className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              + Chính sách mới
            </Link>
          )}
        </div>
      </div>

      {/* Members table */}
      <section className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">
            Thành viên ({team.members.length})
          </h2>
        </div>

        <div className="divide-y divide-gray-50">
          {team.members.map((member, idx) => (
            <div
              key={member.id}
              className="px-5 py-3.5 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-400 w-5 text-right">{idx + 1}</span>
                <div>
                  <p className="font-medium text-gray-900 text-sm">
                    {member.user.fullName}
                    {member.userId === currentUser.id && (
                      <span className="ml-2 text-xs text-blue-600">(bạn)</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-400">{member.user.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    member.role === "MANAGER"
                      ? "bg-purple-100 text-purple-700"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {member.role === "MANAGER" ? "Quản lý" : "Thành viên"}
                </span>
                {isManager && (
                  <TeamMemberActions
                    teamId={id}
                    userId={member.userId}
                    currentRole={member.role}
                    canManage={isManager}
                    canDelete={
                      currentUser.systemRole === "ADMIN" ||
                      (myMembership?.role === "MANAGER" && member.userId !== currentUser.id)
                    }
                  />
                )}
              </div>
            </div>
          ))}
        </div>

        {isManager && (
          <div className="px-5 py-4 border-t border-gray-100 bg-gray-50 rounded-b-xl">
            <AddMemberForm
              teamId={id}
              availableUsers={allUsers}
              activePolicyIds={team.rotationPolicies.map((policy) => policy.id)}
            />
          </div>
        )}
      </section>

      {/* Rotation Policies */}
      <section className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Chính sách xoay vòng</h2>
        </div>
        <div className="divide-y divide-gray-50">
          {team.rotationPolicies.map((policy) => (
            <div key={policy.id} className="px-5 py-4 flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900 text-sm">{policy.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {policy.cadence} • {policy.shiftDurationHours}h/ca • Xác nhận trước {policy.confirmationDueHours}h
                </p>
              </div>
              <div className="flex items-center gap-2">
                {isManager && (
                  <PublishBatchForm policyId={policy.id} policyName={policy.name} />
                )}
                <Link
                  href={`/policies/${policy.id}`}
                  className="text-sm text-blue-600 hover:text-blue-700"
                >
                  Chi tiết →
                </Link>
              </div>
            </div>
          ))}
          {team.rotationPolicies.length === 0 && (
            <p className="px-5 py-8 text-center text-gray-400 text-sm">
              Chưa có chính sách xoay vòng. {isManager && (
                <Link href={`/policies/new?teamId=${id}`} className="text-blue-600">Tạo ngay</Link>
              )}
            </p>
          )}
        </div>
      </section>

      {/* Notification channels */}
      <section className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Kênh thông báo nhóm</h2>
          <p className="text-xs text-gray-400 mt-0.5">Email, Telegram, Teams — dùng để thông báo sự kiện cho cả nhóm.</p>
        </div>
        <NotificationChannels
          teamId={id}
          initial={team.notificationChannels}
          isManager={isManager}
        />
      </section>
    </div>
  );
}
