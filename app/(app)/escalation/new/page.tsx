import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { SystemRole } from "@/app/generated/prisma/client";
import { EscalationForm } from "../escalation-form";

export const metadata = { title: "Tạo Escalation Chain" };

export default async function NewEscalationPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, systemRole: true },
  });
  if (!currentUser || currentUser.systemRole !== SystemRole.ADMIN) redirect("/escalation");

  const teams = await prisma.team.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Tạo Escalation Chain</h1>
        <p className="text-sm text-gray-500 mt-1">Định nghĩa chuỗi thông báo leo thang khi ca trực không phản hồi.</p>
      </div>
      <EscalationForm teams={teams} />
    </div>
  );
}
