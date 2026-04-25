import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { NewTeamForm } from "./new-team-form";

export const metadata = { title: "Tạo nhóm trực" };

export default async function NewTeamPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { systemRole: true },
  });
  if (currentUser?.systemRole !== "ADMIN") redirect("/teams");

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Tạo nhóm trực</h1>
        <p className="text-sm text-gray-500 mt-1">Nhóm trực là đơn vị tổ chức cho lịch trực và cảnh báo.</p>
      </div>
      <NewTeamForm />
    </div>
  );
}
