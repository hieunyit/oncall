import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { AppHeader } from "@/components/app-header";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="flex h-screen overflow-hidden">
      <AppSidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <AppHeader user={session.user} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
