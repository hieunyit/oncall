import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import { SystemRole } from "@/app/generated/prisma/client";
import { EscalationForm } from "../../escalation-form";

export const metadata = { title: "Chỉnh sửa Escalation Chain" };

export default async function EditEscalationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, systemRole: true },
  });
  if (!currentUser || currentUser.systemRole !== SystemRole.ADMIN) redirect("/escalation");

  const { id } = await params;
  const policy = await prisma.escalationPolicy.findUnique({
    where: { id },
    include: { rules: { orderBy: { stepOrder: "asc" } } },
  });
  if (!policy) notFound();

  const teams = await prisma.team.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Chỉnh sửa Escalation Chain</h1>
        <p className="text-sm text-gray-500 mt-1">{policy.name}</p>
      </div>
      <EscalationForm teams={teams} existing={policy} />
    </div>
  );
}
