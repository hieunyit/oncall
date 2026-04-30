import Link from "next/link";
import { format, formatDistanceToNowStrict } from "date-fns";
import { vi } from "date-fns/locale";
import { redirect } from "next/navigation";
import {
  DeliveryStatus,
  SystemRole,
  type Prisma,
} from "@/app/generated/prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ResendButton } from "./resend-button";

type PageProps = {
  searchParams: Promise<{ status?: string; page?: string }>;
};

const STATUS_ORDER: DeliveryStatus[] = [
  DeliveryStatus.FAILED,
  DeliveryStatus.RETRYING,
  DeliveryStatus.QUEUED,
  DeliveryStatus.SENT,
  DeliveryStatus.DELIVERED,
  DeliveryStatus.CANCELLED,
];

const STATUS_STYLE: Record<
  DeliveryStatus,
  { label: string; chip: string; dot: string }
> = {
  QUEUED: {
    label: "Đang xếp hàng",
    chip: "bg-slate-100 text-slate-700 border-slate-200",
    dot: "bg-slate-400",
  },
  SENT: {
    label: "Đã gửi",
    chip: "bg-cyan-100 text-cyan-700 border-cyan-200",
    dot: "bg-cyan-400",
  },
  DELIVERED: {
    label: "Đã nhận",
    chip: "bg-emerald-100 text-emerald-700 border-emerald-200",
    dot: "bg-emerald-400",
  },
  FAILED: {
    label: "Lỗi gửi",
    chip: "bg-rose-100 text-rose-700 border-rose-200",
    dot: "bg-rose-400",
  },
  RETRYING: {
    label: "Đang thử lại",
    chip: "bg-amber-100 text-amber-700 border-amber-200",
    dot: "bg-amber-400",
  },
  CANCELLED: {
    label: "Đã hủy",
    chip: "bg-slate-100 text-slate-500 border-slate-200",
    dot: "bg-slate-300",
  },
};

const CHANNEL_LABELS: Record<string, { label: string; cls: string }> = {
  EMAIL: { label: "Email", cls: "bg-sky-100 text-sky-700 border-sky-200" },
  TELEGRAM: { label: "Telegram", cls: "bg-indigo-100 text-indigo-700 border-indigo-200" },
  TEAMS: { label: "Teams", cls: "bg-violet-100 text-violet-700 border-violet-200" },
};

const EVENT_LABELS: Record<string, string> = {
  SHIFT_REMINDER: "Nhắc ca trực",
  SHIFT_CONFIRMED: "Xác nhận ca",
  SHIFT_DECLINED: "Từ chối ca",
  SCHEDULE_PUBLISHED: "Xuất bản lịch",
  SWAP_APPROVED: "Duyệt đổi ca",
  ALERT_FIRING: "Cảnh báo",
  ESCALATION: "Escalation",
  SCHEDULE_ASSIGNED: "Phân ca mới",
  TEAM_MEMBER_ADDED: "Thêm vào nhóm",
};

function toSafeStatus(value?: string): DeliveryStatus | undefined {
  if (!value) return undefined;
  return (Object.values(DeliveryStatus) as string[]).includes(value)
    ? (value as DeliveryStatus)
    : undefined;
}

function toPage(value?: string) {
  const num = Number(value ?? "1");
  if (!Number.isFinite(num) || num <= 0) return 1;
  return Math.floor(num);
}

function shortId(value: string) {
  if (value.length <= 10) return value;
  return `${value.slice(0, 8)}...`;
}

function errorSummary(value: Prisma.JsonValue | null) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const head = value[0];
    if (typeof head === "string") return head;
    return "Danh sách lỗi";
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const firstMessage =
      (typeof obj.message === "string" && obj.message) ||
      (typeof obj.error === "string" && obj.error) ||
      (typeof obj.detail === "string" && obj.detail) ||
      (typeof obj.description === "string" && obj.description);
    if (firstMessage) return firstMessage;
    return "Lỗi không rõ chi tiết";
  }

  return null;
}

function getPageList(page: number, totalPages: number) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const pages = new Set<number>([1, totalPages, page - 1, page, page + 1]);
  if (page <= 3) pages.add(2);
  if (page >= totalPages - 2) pages.add(totalPages - 1);
  return [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
}

function buildHref(status: DeliveryStatus | undefined, page: number) {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/notifications?${query}` : "/notifications";
}

export default async function NotificationsPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { systemRole: true },
  });

  if (currentUser?.systemRole !== SystemRole.ADMIN) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-800">
        Chỉ ADMIN mới có thể xem trang thông báo hệ thống.
      </div>
    );
  }

  const params = await searchParams;
  const activeStatus = toSafeStatus(params.status);
  const rawPage = toPage(params.page);
  const limit = 30;

  const where: Prisma.NotificationDeliveryWhereInput = activeStatus
    ? { status: activeStatus }
    : {};

  const [stats, totalFiltered] = await Promise.all([
    prisma.notificationDelivery.groupBy({
      by: ["status"],
      _count: { status: true },
    }),
    prisma.notificationDelivery.count({ where }),
  ]);

  const statMap = Object.fromEntries(stats.map((item) => [item.status, item._count.status]));
  const totalAll = Object.values(statMap).reduce((sum, count) => sum + count, 0);
  const deliveredCount = statMap[DeliveryStatus.DELIVERED] ?? 0;
  const failedCount = statMap[DeliveryStatus.FAILED] ?? 0;
  const retryingCount = statMap[DeliveryStatus.RETRYING] ?? 0;
  const deliveryRate = totalAll > 0 ? Math.round((deliveredCount / totalAll) * 100) : 0;
  const failureRate = totalAll > 0 ? Math.round((failedCount / totalAll) * 100) : 0;

  const totalPages = Math.max(1, Math.ceil(totalFiltered / limit));
  const pageNum = Math.min(rawPage, totalPages);

  const deliveries = await prisma.notificationDelivery.findMany({
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
  });

  const userIds = [...new Set(deliveries.map((d) => d.message.recipientId))];
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, fullName: true },
      })
    : [];
  const userMap = Object.fromEntries(users.map((u) => [u.id, u.fullName]));
  const pageList = getPageList(pageNum, totalPages);

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-700 bg-gradient-to-r from-slate-900 via-slate-900 to-indigo-900 px-6 py-5 text-white shadow-sm">
        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-300">
          Delivery Monitoring
        </p>
        <h1 className="mt-1 text-2xl font-semibold">Trung tâm thông báo</h1>
        <p className="mt-1 text-sm text-slate-300">
          Theo dõi độ ổn định gửi Email, Telegram và Teams theo thời gian thực.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full border border-slate-600 bg-slate-800/80 px-2.5 py-1">
            Tổng bản ghi: {totalAll}
          </span>
          <span className="rounded-full border border-slate-600 bg-slate-800/80 px-2.5 py-1">
            Thành công: {deliveryRate}%
          </span>
          <span className="rounded-full border border-slate-600 bg-slate-800/80 px-2.5 py-1">
            Lỗi: {failureRate}%
          </span>
          <span className="rounded-full border border-slate-600 bg-slate-800/80 px-2.5 py-1">
            Cập nhật: {format(new Date(), "dd/MM/yyyy HH:mm")}
          </span>
          {activeStatus && (
            <span className="rounded-full border border-indigo-400/60 bg-indigo-500/20 px-2.5 py-1">
              Bộ lọc: {STATUS_STYLE[activeStatus].label}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label="Tổng lượt gửi"
          value={totalAll}
          hint={`${totalFiltered} trong bộ lọc hiện tại`}
          accent="text-indigo-700"
          badge="bg-indigo-100 text-indigo-700"
        />
        <MetricCard
          label="Đã nhận"
          value={deliveredCount}
          hint={`${deliveryRate}% toàn hệ thống`}
          accent="text-emerald-700"
          badge="bg-emerald-100 text-emerald-700"
        />
        <MetricCard
          label="Thất bại"
          value={failedCount}
          hint={`${failureRate}% toàn hệ thống`}
          accent="text-rose-700"
          badge="bg-rose-100 text-rose-700"
        />
        <MetricCard
          label="Đang retry"
          value={retryingCount}
          hint="Đợi xử lý lại"
          accent="text-amber-700"
          badge="bg-amber-100 text-amber-700"
        />
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusFilterChip
            href={buildHref(undefined, 1)}
            label="Tất cả"
            count={totalAll}
            active={!activeStatus}
          />
          {STATUS_ORDER.map((status) => (
            <StatusFilterChip
              key={status}
              href={buildHref(status, 1)}
              label={STATUS_STYLE[status].label}
              count={statMap[status] ?? 0}
              active={activeStatus === status}
              chipClass={STATUS_STYLE[status].chip}
              dotClass={STATUS_STYLE[status].dot}
            />
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-5 py-4">
          <p className="text-sm font-semibold text-gray-900">Lịch sử gửi thông báo</p>
          <p className="text-xs text-gray-500">
            Tự động làm mới khi bạn thao tác gửi lại bản ghi lỗi.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Kênh</th>
                <th className="px-4 py-3 text-left font-semibold">Sự kiện</th>
                <th className="px-4 py-3 text-left font-semibold">Người nhận</th>
                <th className="px-4 py-3 text-left font-semibold">Trạng thái</th>
                <th className="px-4 py-3 text-left font-semibold">Thử</th>
                <th className="px-4 py-3 text-left font-semibold">Thời gian</th>
                <th className="px-4 py-3 text-left font-semibold">Chi tiết lỗi</th>
                <th className="px-4 py-3 text-right font-semibold">Hành động</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {deliveries.map((delivery) => {
                const statusStyle = STATUS_STYLE[delivery.status];
                const channel = CHANNEL_LABELS[delivery.channelType] ?? {
                  label: delivery.channelType,
                  cls: "bg-slate-100 text-slate-700 border-slate-200",
                };
                const eventLabel =
                  EVENT_LABELS[delivery.message.eventType] ?? delivery.message.eventType;
                const recipient = userMap[delivery.message.recipientId];
                const errText = errorSummary(delivery.errorJson);

                return (
                  <tr key={delivery.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${channel.cls}`}
                      >
                        {channel.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-800">{eventLabel}</p>
                      <p className="text-[11px] text-gray-500">{delivery.message.templateId}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-800">{recipient ?? "Không xác định"}</p>
                      {!recipient && (
                        <p className="text-[11px] font-mono text-gray-500">
                          {shortId(delivery.message.recipientId)}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${statusStyle.chip}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${statusStyle.dot}`} />
                        {statusStyle.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-semibold tabular-nums text-gray-700">
                      {delivery.attemptCount}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs font-medium text-gray-800">
                        {format(delivery.createdAt, "dd/MM HH:mm", { locale: vi })}
                      </p>
                      <p className="text-[11px] text-gray-500">
                        {formatDistanceToNowStrict(delivery.createdAt, {
                          addSuffix: true,
                          locale: vi,
                        })}
                      </p>
                      {delivery.lastAttemptAt && (
                        <p className="text-[11px] text-gray-500">
                          Lần thử cuối: {format(delivery.lastAttemptAt, "HH:mm:ss")}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {errText ? (
                        <span title={errText} className="block max-w-[280px] truncate">
                          {errText}
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {delivery.status === DeliveryStatus.FAILED ? (
                        <ResendButton deliveryId={delivery.id} />
                      ) : (
                        <span className="text-xs text-gray-400">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {deliveries.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-10 text-center text-sm text-gray-500">
                    Không có bản ghi nào cho bộ lọc hiện tại.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Link
            href={buildHref(activeStatus, Math.max(1, pageNum - 1))}
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              pageNum === 1
                ? "pointer-events-none border-gray-200 text-gray-400"
                : "border-gray-300 text-gray-700 hover:bg-gray-50"
            }`}
          >
            Trước
          </Link>

          {pageList.map((p, index) => {
            const prev = pageList[index - 1];
            const showGap = prev && p - prev > 1;
            return (
              <div key={p} className="flex items-center gap-2">
                {showGap && <span className="text-gray-400">...</span>}
                <Link
                  href={buildHref(activeStatus, p)}
                  className={`h-8 min-w-8 rounded-lg px-2 text-center text-sm leading-8 ${
                    p === pageNum
                      ? "bg-indigo-600 font-semibold text-white"
                      : "border border-gray-300 text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {p}
                </Link>
              </div>
            );
          })}

          <Link
            href={buildHref(activeStatus, Math.min(totalPages, pageNum + 1))}
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              pageNum === totalPages
                ? "pointer-events-none border-gray-200 text-gray-400"
                : "border-gray-300 text-gray-700 hover:bg-gray-50"
            }`}
          >
            Sau
          </Link>
        </div>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  hint,
  accent,
  badge,
}: {
  label: string;
  value: string | number;
  hint: string;
  accent: string;
  badge: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge}`}>Live</span>
      </div>
      <p className={`mt-2 text-2xl font-bold tabular-nums ${accent}`}>{value}</p>
      <p className="mt-1 text-xs text-gray-500">{hint}</p>
    </div>
  );
}

function StatusFilterChip({
  href,
  label,
  count,
  active,
  chipClass,
  dotClass,
}: {
  href: string;
  label: string;
  count: number;
  active: boolean;
  chipClass?: string;
  dotClass?: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm transition-colors ${
        active
          ? "border-indigo-400 bg-indigo-50 text-indigo-700"
          : chipClass
            ? chipClass
            : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
      }`}
    >
      {dotClass && <span className={`h-2 w-2 rounded-full ${dotClass}`} />}
      <span className="font-medium">{label}</span>
      <span className="rounded-md bg-white/70 px-1.5 py-0.5 text-xs font-semibold tabular-nums">
        {count}
      </span>
    </Link>
  );
}
