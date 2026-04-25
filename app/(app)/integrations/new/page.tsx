import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { NewIntegrationForm } from "./new-integration-form";

export const metadata = { title: "Tạo Integration" };

export default async function NewIntegrationPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, systemRole: true },
  });
  if (!currentUser) redirect("/login");

  const teams = await prisma.team.findMany({
    where:
      currentUser.systemRole === "ADMIN"
        ? {}
        : { members: { some: { userId: currentUser.id, role: "MANAGER" } } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  if (teams.length === 0) redirect("/integrations");

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Tạo Alert Integration</h1>
        <p className="text-sm text-gray-500 mt-1">
          Sau khi tạo bạn sẽ nhận được webhook URL để cấu hình trên hệ thống giám sát.
        </p>
      </div>
      <NewIntegrationForm teams={teams} />
    </div>
  );
}
