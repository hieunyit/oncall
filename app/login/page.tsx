import { signIn } from "@/lib/auth";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const session = await auth();
  const { callbackUrl } = await searchParams;

  if (session?.user) {
    redirect(callbackUrl ?? "/dashboard");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">On-Call Manager</h1>
          <p className="mt-2 text-gray-600">Quản lý lịch trực và thông báo</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">Đăng nhập</h2>
          <form
            action={async () => {
              "use server";
              await signIn("keycloak", {
                redirectTo: callbackUrl ?? "/dashboard",
              });
            }}
          >
            <button
              type="submit"
              className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
              </svg>
              Đăng nhập qua Keycloak (SSO)
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
