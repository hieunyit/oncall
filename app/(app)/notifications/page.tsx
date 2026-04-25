import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { SystemRole, DeliveryStatus } from "@/app/generated/prisma/client";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { ResendButton } from "./resend-button";

const STATUS_COLORS: Record<string, string> = {
  QUEUED: "bg-gray-100 text-gray-600",
  SENT: "bg-blue-100 text-blue-700",
  DELIVERED: "bg-green-100 text-green-700",
  FAILED: "bg-red-100 text-red-700",
  RETRYING: "bg-yellow-100 text-yellow-700",
  CANCELLED: "bg-gray-100 text-gray-400",
};

const CHANNEL_ICONS: Record<string, string> = {
  EMAIL: "📧",
  TELEGRAM: "✈️",
  TEAMS: "💼",
};

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
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

  const { status, page } = await searchParams;
  const pageNum = Number(page ?? 1);
  const limit = 30;

  const where = {
    ...(status && Object.values(DeliveryStatus).includes(status as DeliveryStatus)
      ? { status: status as DeliveryStatus }
      : {}),
  };

  const [deliveries, total, stats] = await Promise.all([
    prisma.notificationDelivery.findMany({
      where,
      include: {
        message: {
          select: {
            eventType: true,
            templateId: true,
            channelType: true,
            createdAt: true,
            recipientId: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (pageNum - 1) * limit,
      take: limit,
    }),
    prisma.notificationDelivery.count({ where }),
    // Status counts
    prisma.notificationDelivery.groupBy({
      by: ["status"],
      _count: { status: true },
    }),
  ]);

  const statMap = Object.fromEntries(
    stats.map((s) => [s.status, s._count.status])
  );

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Thông báo</h1>

      {/* Stats */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        {Object.entries(DeliveryStatus).map(([key, val]) => (
          <a
            key={key}
            href={`/notifications?status=${val}`}
            className={`rounded-xl border p-3 text-center hover:shadow-sm transition-shadow ${
              status === val ? "border-blue-300 bg-blue-50" : "border-gray-200 bg-white"
            }`}
          >
            <p className="text-xl font-bold text-gray-900">{statMap[val] ?? 0}</p>
            <p className="text-xs text-gray-500 mt-0.5">{key}</p>
          </a>
        ))}
        <a
          href="/notifications"
          className={`rounded-xl border p-3 text-center hover:shadow-sm transition-shadow ${
            !status ? "border-blue-300 bg-blue-50" : "border-gray-200 bg-white"
          }`}
        >
          <p className="text-xl font-bold text-gray-900">{total}</p>
          <p className="text-xs text-gray-500 mt-0.5">TẤT CẢ</p>
        </a>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Kênh</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Sự kiện</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Trạng thái</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Số lần thử</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Thời gian</th>
              <th className="w-20" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {deliveries.map((d) => (
              <tr key={d.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <span className="flex items-center gap-1.5">
                    {CHANNEL_ICONS[d.channelType] ?? "📬"}
                    <span className="text-gray-600">{d.channelType}</span>
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-600 font-mono text-xs">
                  {d.message.eventType}
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[d.status] ?? ""}`}>
                    {d.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-500">{d.attemptCount}</td>
                <td className="px-4 py-3 text-gray-400 text-xs">
                  {format(d.createdAt, "dd/MM HH:mm", { locale: vi })}
                </td>
                <td className="px-4 py-3">
                  {d.status === "FAILED" && (
                    <ResendButton deliveryId={d.id} />
                  )}
                </td>
              </tr>
            ))}
            {deliveries.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  Không có thông báo nào.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <a
              key={p}
              href={`/notifications?${status ? `status=${status}&` : ""}page=${p}`}
              className={`w-8 h-8 flex items-center justify-center rounded-lg ${
                p === pageNum
                  ? "bg-blue-600 text-white"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {p}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
