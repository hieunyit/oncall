import {
  ChannelType,
  ConfirmationStatus,
  DeliveryStatus,
  IncidentSeverity,
  IncidentStatus,
  ShiftStatus,
  SwapStatus,
  SystemRole,
  TeamRole,
} from "@/app/generated/prisma/client";
import { addDays, endOfMonth, startOfMonth, subMonths } from "date-fns";
import {
  answerCallbackQuery,
  buildTelegramFileDownloadUrl,
  editMessageText,
  editTelegramDeliveries,
  getTelegramFile,
  sendTelegramDocument,
  sendTelegramMessage,
  TelegramUpdate,
} from "@/lib/notifications/telegram";
import { prisma } from "@/lib/prisma";
import { getPolicyTelegramOptions } from "@/lib/rotation/policy-telegram-options";
import {
  buildScheduleCsvContent,
  buildScheduleExcelHtml,
  buildScheduleExportRows,
} from "@/lib/schedule/export";
import { hasShiftProof, saveShiftProof, type ShiftProofKind } from "@/lib/shift-proof/storage";
import { validateSwapAssignmentConstraints } from "@/lib/rotation/swap-constraints";
import {
  buildBackToMainInlineKeyboard,
  buildMainMenuInlineKeyboard,
} from "@/lib/telegram/bot-config";

const TZ = "Asia/Ho_Chi_Minh";
const ACTIVE_SHIFT_STATUSES: ShiftStatus[] = [ShiftStatus.PUBLISHED, ShiftStatus.ACTIVE];
const REMOVE_REPLY_KEYBOARD = { remove_keyboard: true };

type LinkedUser = {
  id: string;
  fullName: string;
  systemRole: SystemRole;
  teamMembers: Array<{ teamId: string; role: TeamRole }>;
};

type PendingProofRequest = {
  userId: string;
  kind: ShiftProofKind;
  confirmationId?: string;
  shiftId?: string;
  expiresAt: number;
};

const pendingProofRequests = new Map<number, PendingProofRequest>();
const PENDING_PROOF_TTL_MS = 10 * 60 * 1000;

function parseCommandPayload(text: string): { command: string; payload: string | null } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;

  const firstSpace = trimmed.indexOf(" ");
  const rawCommand = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
  const command = rawCommand.slice(1).split("@")[0]?.toLowerCase();
  if (!command) return null;

  const payload = firstSpace === -1 ? null : trimmed.slice(firstSpace + 1).trim();
  return { command, payload: payload || null };
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatShiftRange(startsAt: Date, endsAt: Date): string {
  return `${formatDateTime(startsAt)} -> ${formatDateTime(endsAt)}`;
}

function shortGuid(id: string): string {
  return id.slice(0, 8);
}

type ScheduleExportFormat = "csv" | "excel";

type ScheduleExportWindow = {
  start: Date;
  end: Date;
  monthToken: string;
};

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatMonthToken(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

function parseMonthToken(raw: string): ScheduleExportWindow | null {
  const match = raw.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const start = startOfMonth(new Date(year, month - 1, 1));
  const end = endOfMonth(start);
  return { start, end, monthToken: raw };
}

function resolveExportWindow(monthToken: string | null): ScheduleExportWindow | null {
  if (!monthToken) {
    const start = startOfMonth(new Date());
    const end = endOfMonth(start);
    return {
      start,
      end,
      monthToken: formatMonthToken(start),
    };
  }

  return parseMonthToken(monthToken);
}

function parseExportCommandPayload(payload: string | null): {
  format: ScheduleExportFormat | null;
  monthToken: string | null;
  error?: string;
} {
  if (!payload) {
    return { format: null, monthToken: null };
  }

  let format: ScheduleExportFormat | null = null;
  let monthToken: string | null = null;

  for (const tokenRaw of payload.split(/\s+/).filter(Boolean)) {
    const token = tokenRaw.trim().toLowerCase();
    if (!token) continue;

    if (token === "csv") {
      if (format && format !== "csv") {
        return { format: null, monthToken: null, error: "Chỉ chọn một định dạng export." };
      }
      format = "csv";
      continue;
    }
    if (token === "excel" || token === "xls" || token === "xlsx") {
      if (format && format !== "excel") {
        return { format: null, monthToken: null, error: "Chỉ chọn một định dạng export." };
      }
      format = "excel";
      continue;
    }
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(token)) {
      if (monthToken) {
        return { format: null, monthToken: null, error: "Chỉ hỗ trợ một tham số tháng YYYY-MM." };
      }
      monthToken = token;
      continue;
    }

    return {
      format: null,
      monthToken: null,
      error: "Payload không hợp lệ. Dùng /export csv 2026-05 hoặc /export excel 2026-05.",
    };
  }

  return { format, monthToken };
}

function getManagedTeamIds(user: LinkedUser): string[] {
  return [...new Set(
    user.teamMembers
      .filter((member) => member.role === TeamRole.MANAGER)
      .map((member) => member.teamId)
  )];
}

function canExportSchedule(user: LinkedUser): boolean {
  return user.systemRole === SystemRole.ADMIN || getManagedTeamIds(user).length > 0;
}

function setPendingProofRequest(chatId: number, request: Omit<PendingProofRequest, "expiresAt">) {
  pendingProofRequests.set(chatId, {
    ...request,
    expiresAt: Date.now() + PENDING_PROOF_TTL_MS,
  });
}

function readPendingProofRequest(chatId: number, userId: string): PendingProofRequest | null {
  const pending = pendingProofRequests.get(chatId);
  if (!pending) return null;
  if (pending.userId !== userId) return null;
  if (pending.expiresAt < Date.now()) {
    pendingProofRequests.delete(chatId);
    return null;
  }
  return pending;
}

function clearPendingProofRequest(chatId: number): void {
  pendingProofRequests.delete(chatId);
}

function parseProofCaption(caption: string): { kind: ShiftProofKind; ref: string } | null {
  const trimmed = caption.trim();
  if (!trimmed) return null;

  const checkInMatch = trimmed.match(/^(checkin|vao|check-in)[:\s]+([a-z0-9-]+)$/i);
  if (checkInMatch) {
    return { kind: "CHECK_IN", ref: checkInMatch[2] };
  }
  const checkOutMatch = trimmed.match(/^(checkout|ra|check-out)[:\s]+([a-z0-9-]+)$/i);
  if (checkOutMatch) {
    return { kind: "CHECK_OUT", ref: checkOutMatch[2] };
  }
  return null;
}

function getLargestPhotoFromMessage(update: TelegramUpdate): string | null {
  const photos = update.message?.photo;
  if (!Array.isArray(photos) || photos.length === 0) return null;
  const largest = photos[photos.length - 1];
  return largest?.file_id ?? null;
}

async function downloadTelegramPhotoBuffer(fileId: string): Promise<{ buffer: Buffer; fileName: string }> {
  const fileInfo = await getTelegramFile(fileId);
  if (!fileInfo.ok || !fileInfo.result?.file_path) {
    throw new Error(fileInfo.description ?? "Không thể lấy file ảnh từ Telegram");
  }

  const filePath = fileInfo.result.file_path;
  const downloadUrl = buildTelegramFileDownloadUrl(filePath);
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`Tải ảnh Telegram thất bại (${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const parsedName = filePath.split("/").pop() ?? `${fileId}.jpg`;
  return { buffer: Buffer.from(arrayBuffer), fileName: parsedName };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isSeverity(value: string): value is IncidentSeverity {
  return ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(value);
}

function supportText() {
  const custom = process.env.TELEGRAM_SUPPORT_TEXT?.trim();
  if (custom) return custom;
  return [
    "<b>Hỗ trợ</b>",
    "- Nếu cần hỗ trợ, liên hệ quản trị hệ thống.",
    "- Manager/Admin có thể export lịch bằng /export csv YYYY-MM hoặc /export excel YYYY-MM.",
    "- Dùng /menu để quay lại menu chính.",
  ].join("\n");
}

async function getLinkedUserByChatId(chatId: number): Promise<LinkedUser | null> {
  return prisma.user.findFirst({
    where: { telegramChatId: BigInt(chatId) },
    select: {
      id: true,
      fullName: true,
      systemRole: true,
      teamMembers: {
        select: { teamId: true, role: true },
      },
    },
  });
}

async function sendMainMenu(chatId: number, userName?: string) {
  const intro = [
    `👋 Xin chào${userName ? ` <b>${escapeHtml(userName)}</b>` : ""}!`,
    "Chọn chức năng bên dưới hoặc dùng lệnh:",
    "/oncall, /myshifts, /export, /checklist, /swaps, /report, /help",
  ].join("\n");

  await sendTelegramMessage(chatId.toString(), intro, "HTML", REMOVE_REPLY_KEYBOARD);
}

async function sendMainMenuInline(chatId: number) {
  await sendTelegramMessage(
    chatId.toString(),
    "<b>Menu chính</b>\nChọn tính năng:",
    "HTML",
    buildMainMenuInlineKeyboard()
  );
}

async function sendExportMenu(chatId: number, user: LinkedUser, editTarget?: { messageId: number }) {
  if (!canExportSchedule(user)) {
    const text = "❌ Chỉ admin hoặc manager mới có quyền export lịch trực.";
    if (editTarget) {
      await editMessageText(chatId, editTarget.messageId, text, "HTML", buildBackToMainInlineKeyboard());
    } else {
      await sendTelegramMessage(chatId.toString(), text, "HTML", buildBackToMainInlineKeyboard());
    }
    return;
  }

  const currentMonth = formatMonthToken(new Date());
  const previousMonth = formatMonthToken(subMonths(new Date(), 1));
  const text = [
    "📤 <b>Export lịch trực</b>",
    "Phạm vi mặc định: lịch trong tháng.",
    "",
    "Dùng nhanh bằng lệnh:",
    "<code>/export csv 2026-05</code>",
    "<code>/export excel 2026-05</code>",
  ].join("\n");
  const keyboard = {
    inline_keyboard: [
      [
        { text: `CSV ${currentMonth}`, callback_data: `exp:csv:${currentMonth}` },
        { text: `Excel ${currentMonth}`, callback_data: `exp:excel:${currentMonth}` },
      ],
      [
        { text: `CSV ${previousMonth}`, callback_data: `exp:csv:${previousMonth}` },
        { text: `Excel ${previousMonth}`, callback_data: `exp:excel:${previousMonth}` },
      ],
      [{ text: "🏠 Menu chính", callback_data: "menu:main" }],
    ],
  };

  if (editTarget) {
    await editMessageText(chatId, editTarget.messageId, text, "HTML", keyboard);
  } else {
    await sendTelegramMessage(chatId.toString(), text, "HTML", keyboard);
  }
}

async function sendScheduleExportDocument(
  chatId: number,
  user: LinkedUser,
  format: ScheduleExportFormat,
  monthToken: string | null
) {
  if (!canExportSchedule(user)) {
    await sendTelegramMessage(
      chatId.toString(),
      "❌ Chỉ admin hoặc manager mới có quyền export lịch trực.",
      "HTML"
    );
    return;
  }

  const exportWindow = resolveExportWindow(monthToken);
  if (!exportWindow) {
    await sendTelegramMessage(
      chatId.toString(),
      "❌ Tháng không hợp lệ. Dùng định dạng <code>YYYY-MM</code>, ví dụ <code>2026-05</code>.",
      "HTML"
    );
    return;
  }

  const isAdmin = user.systemRole === SystemRole.ADMIN;
  const managedTeamIds = getManagedTeamIds(user);
  if (!isAdmin && managedTeamIds.length === 0) {
    await sendTelegramMessage(
      chatId.toString(),
      "❌ Bạn chưa quản lý team nào để export lịch.",
      "HTML"
    );
    return;
  }

  const shifts = await prisma.shift.findMany({
    where: {
      startsAt: { lte: exportWindow.end },
      endsAt: { gte: exportWindow.start },
      status: { in: [ShiftStatus.PUBLISHED, ShiftStatus.ACTIVE, ShiftStatus.COMPLETED] },
      policy: isAdmin ? undefined : { teamId: { in: managedTeamIds } },
    },
    include: {
      assignee: { select: { fullName: true } },
      backup: { select: { fullName: true } },
      policy: { select: { name: true, team: { select: { name: true } } } },
      confirmation: { select: { status: true } },
      verificationPhotos: {
        select: { kind: true, storagePath: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { startsAt: "asc" },
  });

  if (shifts.length === 0) {
    await sendTelegramMessage(
      chatId.toString(),
      `ℹ️ Không có ca trực trong tháng <b>${exportWindow.monthToken}</b> để export.`,
      "HTML"
    );
    return;
  }

  const rows = buildScheduleExportRows(
    shifts.map((shift) => {
      const checkInPhoto = shift.verificationPhotos.find((photo) => photo.kind === "CHECK_IN");
      const checkOutPhoto = shift.verificationPhotos.find((photo) => photo.kind === "CHECK_OUT");

      return {
        startsAt: shift.startsAt,
        endsAt: shift.endsAt,
        teamName: shift.policy.team.name,
        policyName: shift.policy.name,
        assigneeName: shift.assignee.fullName,
        backupName: shift.backup?.fullName ?? "",
        status: shift.status,
        confirmationStatus: shift.confirmation?.status ?? "",
        source: shift.source,
        checkInAt: checkInPhoto?.createdAt ?? null,
        checkOutAt: checkOutPhoto?.createdAt ?? null,
        checkInPhotoPath: checkInPhoto?.storagePath ?? null,
        checkOutPhotoPath: checkOutPhoto?.storagePath ?? null,
        note: shift.notes ?? "",
      };
    }),
    { appBaseUrl: process.env.NEXT_PUBLIC_APP_URL ?? null }
  );

  const content =
    format === "csv"
      ? buildScheduleCsvContent(rows)
      : buildScheduleExcelHtml(rows);
  const extension = format === "csv" ? "csv" : "xls";
  const mimeType =
    format === "csv" ? "text/csv;charset=utf-8;" : "application/vnd.ms-excel;charset=utf-8;";
  const fileName = `lich-truc-${exportWindow.monthToken}.${extension}`;
  const bytes = Buffer.from(`\uFEFF${content}`, "utf8");

  const result = await sendTelegramDocument(chatId.toString(), {
    fileName,
    bytes,
    caption: `📎 Export ${format.toUpperCase()} tháng ${exportWindow.monthToken} (${rows.length} ca).`,
    contentType: mimeType,
  });

  if (!result.ok) {
    await sendTelegramMessage(
      chatId.toString(),
      `❌ Gửi file thất bại: ${result.description ?? "Lỗi không xác định"}`,
      "HTML"
    );
  }
}

async function requireLinkedUser(chatId: number): Promise<LinkedUser | null> {
  const linked = await getLinkedUserByChatId(chatId);
  if (linked) return linked;

  await sendTelegramMessage(
    chatId.toString(),
    [
      "❌ Chat này chưa liên kết tài khoản On-Call.",
      "Vào ứng dụng -> Hồ sơ -> Kết nối Telegram để tạo mã liên kết.",
      "Sau đó gửi: <code>/link &lt;mã_liên_kết&gt;</code>",
    ].join("\n"),
    "HTML",
    buildBackToMainInlineKeyboard()
  );
  return null;
}

async function linkTelegramByToken(chatId: number, linkToken: string) {
  const user = await prisma.user.findFirst({
    where: {
      telegramLinkToken: linkToken,
      telegramLinkTokenExp: { gt: new Date() },
    },
    select: { id: true, fullName: true },
  });

  if (!user) return null;

  await prisma.$transaction([
    prisma.user.updateMany({
      where: {
        telegramChatId: BigInt(chatId),
        id: { not: user.id },
      },
      data: { telegramChatId: null },
    }),
    prisma.user.update({
      where: { id: user.id },
      data: {
        telegramChatId: BigInt(chatId),
        telegramLinkToken: null,
        telegramLinkTokenExp: null,
      },
    }),
  ]);

  return user;
}

async function sendOncallNow(chatId: number) {
  const now = new Date();
  const activeShifts = await prisma.shift.findMany({
    where: {
      startsAt: { lte: now },
      endsAt: { gte: now },
      status: { in: ACTIVE_SHIFT_STATUSES },
    },
    include: {
      assignee: { select: { fullName: true } },
      policy: { select: { name: true, team: { select: { name: true } } } },
    },
    orderBy: { startsAt: "asc" },
    take: 12,
  });

  if (activeShifts.length === 0) {
    await sendTelegramMessage(
      chatId.toString(),
      "ℹ️ Hiện tại không có ca nào đang trực.",
      "HTML",
      buildBackToMainInlineKeyboard()
    );
    return;
  }

  const lines = ["🟢 <b>Ca đang trực</b>", ""];
  for (const shift of activeShifts) {
    lines.push(
      `• <b>${escapeHtml(shift.assignee.fullName)}</b> - ${escapeHtml(shift.policy.team.name)} / ${escapeHtml(shift.policy.name)}`,
      `  ${formatShiftRange(shift.startsAt, shift.endsAt)}`,
      ""
    );
  }

  await sendTelegramMessage(
    chatId.toString(),
    lines.join("\n").trim(),
    "HTML",
    buildBackToMainInlineKeyboard()
  );
}

async function sendMyShifts(chatId: number, user: LinkedUser) {
  const now = new Date();
  const from = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  const to = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const shifts = await prisma.shift.findMany({
    where: {
      assigneeId: user.id,
      startsAt: { lte: to },
      endsAt: { gte: from },
      status: { in: [ShiftStatus.PUBLISHED, ShiftStatus.ACTIVE, ShiftStatus.COMPLETED] },
    },
    include: {
      policy: { select: { name: true, team: { select: { name: true } } } },
      confirmation: { select: { id: true, status: true } },
    },
    orderBy: { startsAt: "asc" },
    take: 20,
  });

  if (shifts.length === 0) {
    await sendTelegramMessage(
      chatId.toString(),
      "ℹ️ Bạn chưa có ca trực trong 7 ngày gần nhất/kế tiếp.",
      "HTML",
      buildBackToMainInlineKeyboard()
    );
    return;
  }

  const lines = ["📆 <b>Lịch trực của tôi</b>", ""];
  for (const shift of shifts) {
    let marker = "⏳";
    if (shift.startsAt <= now && shift.endsAt >= now) marker = "🟢";
    if (shift.endsAt < now) marker = "✅";

    const confirmText = shift.confirmation?.status ? ` | ${shift.confirmation.status}` : "";
    lines.push(
      `${marker} <b>${escapeHtml(shift.policy.team.name)}</b> / ${escapeHtml(shift.policy.name)}${confirmText}`,
      `   ${formatShiftRange(shift.startsAt, shift.endsAt)}`,
      ""
    );
  }

  const pendingUpcoming = shifts
    .filter(
      (shift) =>
        shift.startsAt > now &&
        shift.confirmation?.status === ConfirmationStatus.PENDING &&
        Boolean(shift.confirmation?.id)
    )
    .slice(0, 3);
  if (pendingUpcoming.length > 0) {
    lines.push("⚠️ Có ca sắp tới đang chờ xác nhận trực tiếp bên dưới.", "");
  }

  await sendTelegramMessage(
    chatId.toString(),
    lines.join("\n").trim(),
    "HTML",
    {
      inline_keyboard: [
        ...pendingUpcoming.map((shift, index) => ([
          { text: `✅ Xác nhận ca ${index + 1}`, callback_data: `confirm-id:${shift.confirmation?.id}` },
          { text: `❌ Từ chối ca ${index + 1}`, callback_data: `decline-id:${shift.confirmation?.id}` },
        ])),
        [
          { text: "✅ Checklist", callback_data: "menu:checklist" },
          { text: "🔁 Đổi ca", callback_data: "menu:swaps" },
        ],
        [
          { text: "📝 Báo cáo", callback_data: "menu:report" },
          { text: "🏠 Menu chính", callback_data: "menu:main" },
        ],
      ],
    }
  );
}

type ConfirmationActionInput = {
  id: string;
  shiftId: string;
  userId: string;
  status: ConfirmationStatus;
  shift: {
    startsAt: Date;
    endsAt: Date;
    assignee: { fullName: string };
    policy: { name: string; teamId: string };
  };
};

async function applyConfirmationAction(input: {
  confirmation: ConfirmationActionInput;
  action: "confirm" | "decline";
  actorLabel: string;
}) {
  const { confirmation, action, actorLabel } = input;
  const newStatus =
    action === "confirm" ? ConfirmationStatus.CONFIRMED : ConfirmationStatus.DECLINED;

  await prisma.shiftConfirmation.update({
    where: { id: confirmation.id },
    data: { status: newStatus, respondedAt: new Date() },
  });

  const icon = action === "confirm" ? "✅" : "❌";
  const label = action === "confirm" ? "Đã xác nhận" : "Đã từ chối";
  const updatedText = [
    `${icon} <b>${label} ca trực</b>`,
    "",
    `Ca: <b>${escapeHtml(confirmation.shift.policy.name)}</b>`,
    `Bắt đầu: ${formatDateTime(confirmation.shift.startsAt)}`,
    `Kết thúc: ${formatDateTime(confirmation.shift.endsAt)}`,
    "",
    `Người thực hiện: ${escapeHtml(actorLabel)}`,
  ].join("\n");

  const deliveries = await prisma.notificationDelivery.findMany({
    where: {
      channelType: ChannelType.TELEGRAM,
      status: DeliveryStatus.SENT,
      externalId: { not: null },
      message: { shiftId: confirmation.shiftId },
    },
    select: { externalId: true },
  });
  if (deliveries.length > 0) {
    await editTelegramDeliveries(deliveries, updatedText).catch(() => {});
  }

  import("@/lib/notifications/notify-channel")
    .then(({ notifyTeamChannels }) =>
      notifyTeamChannels({
        teamId: confirmation.shift.policy.teamId,
        eventType:
          newStatus === ConfirmationStatus.CONFIRMED ? "SHIFT_CONFIRMED" : "SHIFT_DECLINED",
        templateId:
          newStatus === ConfirmationStatus.CONFIRMED ? "shift-confirmed" : "shift-declined",
        recipientId: confirmation.userId,
        variables: {
          recipientName: confirmation.shift.assignee.fullName,
          policyName: confirmation.shift.policy.name,
          shiftStart: confirmation.shift.startsAt.toISOString(),
          shiftEnd: confirmation.shift.endsAt.toISOString(),
          appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
        },
      })
    )
    .catch(() => {});

  return { newStatus, updatedText, icon, label };
}

async function handleProofPhotoMessage(update: TelegramUpdate): Promise<boolean> {
  const message = update.message;
  if (!message?.from) return false;
  if (!Array.isArray(message.photo) || message.photo.length === 0) return false;

  const chatId = message.chat.id;
  const linked = await requireLinkedUser(chatId);
  if (!linked) return true;

  const pending = readPendingProofRequest(chatId, linked.id);
  const captionCommand = message.caption ? parseProofCaption(message.caption) : null;

  let proofKind: ShiftProofKind | null = pending?.kind ?? null;
  let confirmationRef: string | undefined = pending?.confirmationId;
  let shiftRef: string | undefined = pending?.shiftId;

  if (!proofKind && captionCommand) {
    proofKind = captionCommand.kind;
    if (captionCommand.kind === "CHECK_IN") {
      confirmationRef = captionCommand.ref;
    } else {
      shiftRef = captionCommand.ref;
    }
  }

  if (!proofKind) {
    await sendTelegramMessage(
      chatId.toString(),
      [
        "📷 Đã nhận ảnh, nhưng chưa biết ảnh thuộc ca nào.",
        "Bấm nút \"Gửi ảnh check-in/check-out\" từ tin nhắc hoặc gửi caption:",
        "<code>checkin:&lt;confirmationId-hoac-token&gt;</code>",
        "<code>checkout:&lt;shiftId&gt;</code>",
      ].join("\n"),
      "HTML"
    );
    return true;
  }

  const fileId = getLargestPhotoFromMessage(update);
  if (!fileId) {
    await sendTelegramMessage(chatId.toString(), "❌ Không đọc được ảnh. Vui lòng thử lại.", "HTML");
    return true;
  }

  try {
    if (proofKind === "CHECK_IN") {
      if (!confirmationRef) {
        await sendTelegramMessage(chatId.toString(), "❌ Thiếu mã xác nhận ca trực.", "HTML");
        return true;
      }

      const byId = isUuid(confirmationRef);
      const confirmation = await prisma.shiftConfirmation.findUnique({
        where: byId ? { id: confirmationRef } : { token: confirmationRef },
        include: {
          shift: {
            include: {
              assignee: { select: { fullName: true } },
              policy: { select: { id: true, name: true, teamId: true } },
            },
          },
        },
      });
      if (!confirmation) {
        await sendTelegramMessage(chatId.toString(), "❌ Không tìm thấy ca trực để check-in.", "HTML");
        return true;
      }
      if (confirmation.userId !== linked.id) {
        await sendTelegramMessage(chatId.toString(), "❌ Bạn không phải người trực của ca này.", "HTML");
        return true;
      }

      const { buffer, fileName } = await downloadTelegramPhotoBuffer(fileId);
      await saveShiftProof({
        shiftId: confirmation.shiftId,
        policyId: confirmation.shift.policy.id,
        userId: linked.id,
        kind: "CHECK_IN",
        fileName,
        fileBuffer: buffer,
        telegramFileId: fileId,
        telegramMessageId: message.message_id,
      });
      clearPendingProofRequest(chatId);

      if (confirmation.status === ConfirmationStatus.PENDING) {
        if (new Date() > confirmation.dueAt) {
          await prisma.shiftConfirmation.update({
            where: { id: confirmation.id },
            data: { status: ConfirmationStatus.EXPIRED },
          });
          await sendTelegramMessage(
            chatId.toString(),
            "⚠️ Đã lưu ảnh check-in, nhưng xác nhận ca đã hết hạn.",
            "HTML"
          );
          return true;
        }

        const policyOptions = await getPolicyTelegramOptions(confirmation.shift.policy.id);
        if (policyOptions.requirePhotoOnConfirm) {
          const checkInExists = await hasShiftProof({
            shiftId: confirmation.shiftId,
            userId: linked.id,
            kind: "CHECK_IN",
          });
          if (!checkInExists) {
            await sendTelegramMessage(
              chatId.toString(),
              "❌ Chưa có ảnh check-in hợp lệ. Vui lòng gửi lại ảnh rõ nét.",
              "HTML"
            );
            return true;
          }
        }

        await applyConfirmationAction({
          confirmation: {
            id: confirmation.id,
            shiftId: confirmation.shiftId,
            userId: confirmation.userId,
            status: confirmation.status,
            shift: {
              startsAt: confirmation.shift.startsAt,
              endsAt: confirmation.shift.endsAt,
              assignee: { fullName: confirmation.shift.assignee.fullName },
              policy: {
                name: confirmation.shift.policy.name,
                teamId: confirmation.shift.policy.teamId,
              },
            },
          },
          action: "confirm",
          actorLabel: linked.fullName,
        });
        await sendTelegramMessage(
          chatId.toString(),
          "✅ Đã lưu ảnh check-in và xác nhận ca trực thành công.",
          "HTML"
        );
        return true;
      }

      await sendTelegramMessage(
        chatId.toString(),
        `✅ Đã lưu ảnh check-in. Trạng thái ca hiện tại: ${confirmation.status}.`,
        "HTML"
      );
      return true;
    }

    if (!shiftRef || !isUuid(shiftRef)) {
      await sendTelegramMessage(chatId.toString(), "❌ Mã ca trực check-out không hợp lệ.", "HTML");
      return true;
    }

    const shift = await prisma.shift.findUnique({
      where: { id: shiftRef },
      include: {
        policy: { select: { id: true, name: true } },
      },
    });
    if (!shift) {
      await sendTelegramMessage(chatId.toString(), "❌ Không tìm thấy ca trực để check-out.", "HTML");
      return true;
    }
    if (shift.assigneeId !== linked.id) {
      await sendTelegramMessage(chatId.toString(), "❌ Bạn không phải người trực của ca này.", "HTML");
      return true;
    }

    const policyOptions = await getPolicyTelegramOptions(shift.policy.id);
    if (!policyOptions.endShiftReminderEnabled && !policyOptions.requirePhotoOnCheckout) {
      await sendTelegramMessage(
        chatId.toString(),
        "ℹ️ Chính sách này chưa bật xác nhận check-out bằng ảnh.",
        "HTML"
      );
      return true;
    }

    const { buffer, fileName } = await downloadTelegramPhotoBuffer(fileId);
    await saveShiftProof({
      shiftId: shift.id,
      policyId: shift.policy.id,
      userId: linked.id,
      kind: "CHECK_OUT",
      fileName,
      fileBuffer: buffer,
      telegramFileId: fileId,
      telegramMessageId: message.message_id,
    });
    clearPendingProofRequest(chatId);

    await sendTelegramMessage(
      chatId.toString(),
      `✅ Đã lưu ảnh check-out cho ca ${escapeHtml(shift.policy.name)}.`,
      "HTML"
    );
    return true;
  } catch (error) {
    await sendTelegramMessage(
      chatId.toString(),
      `❌ Không thể xử lý ảnh: ${escapeHtml((error as Error).message)}`,
      "HTML"
    );
    return true;
  }
}

async function ensureShiftTasksSeeded(shiftId: string, policyId: string) {
  let tasks = await prisma.shiftTask.findMany({
    where: { shiftId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });

  if (tasks.length > 0) return tasks;

  try {
    const rows = await prisma.$queryRaw<Array<{ template_tasks: unknown }>>`
      SELECT template_tasks FROM rotation_policies WHERE id = ${policyId}::uuid
    `;
    const templateTasks = rows[0]?.template_tasks as string[] | null;
    if (Array.isArray(templateTasks) && templateTasks.length > 0) {
      await prisma.shiftTask.createMany({
        data: templateTasks.map((title, order) => ({ shiftId, title, order })),
      });
      tasks = await prisma.shiftTask.findMany({
        where: { shiftId },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      });
    }
  } catch {
    // ignore missing migration/column
  }

  return tasks;
}

async function findChecklistShiftForUser(userId: string) {
  const now = new Date();

  const current = await prisma.shift.findFirst({
    where: {
      assigneeId: userId,
      startsAt: { lte: now },
      endsAt: { gte: now },
      status: { in: ACTIVE_SHIFT_STATUSES },
    },
    include: {
      policy: { select: { id: true, name: true, teamId: true, team: { select: { name: true } } } },
    },
    orderBy: { startsAt: "asc" },
  });
  if (current) return current;

  return prisma.shift.findFirst({
    where: {
      assigneeId: userId,
      startsAt: { gte: new Date(now.getTime() - 2 * 60 * 60 * 1000) },
      status: { in: ACTIVE_SHIFT_STATUSES },
    },
    include: {
      policy: { select: { id: true, name: true, teamId: true, team: { select: { name: true } } } },
    },
    orderBy: { startsAt: "asc" },
  });
}

async function sendChecklistForShift(
  chatId: number,
  user: LinkedUser,
  shiftId: string,
  editTarget?: { messageId: number }
) {
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    include: {
      assignee: { select: { id: true, fullName: true } },
      policy: { select: { id: true, name: true, teamId: true, team: { select: { name: true } } } },
    },
  });

  if (!shift) {
    await sendTelegramMessage(chatId.toString(), "❌ Không tìm thấy ca trực.", "HTML");
    return;
  }

  const isAssignee = shift.assigneeId === user.id;
  const isManager = user.teamMembers.some(
    (m) => m.teamId === shift.policy.teamId && m.role === TeamRole.MANAGER
  );

  if (!isAssignee && !isManager) {
    await sendTelegramMessage(chatId.toString(), "❌ Bạn không có quyền xem checklist ca này.", "HTML");
    return;
  }

  const tasks = await ensureShiftTasksSeeded(shift.id, shift.policy.id);

  const done = tasks.filter((t) => t.isCompleted).length;
  const total = tasks.length;

  const lines = [
    "✅ <b>Checklist ca trực</b>",
    `Ca: <b>${escapeHtml(shift.policy.team.name)} / ${escapeHtml(shift.policy.name)}</b>`,
    `Người trực: <b>${escapeHtml(shift.assignee.fullName)}</b>`,
    `${formatShiftRange(shift.startsAt, shift.endsAt)}`,
    `Tiến độ: <b>${done}/${total}</b>`,
    "",
  ];

  if (tasks.length === 0) {
    lines.push("(Chưa có checklist cho ca này)");
  } else {
    for (const task of tasks) {
      lines.push(`${task.isCompleted ? "✅" : "⬜"} ${escapeHtml(task.title)}`);
    }
  }

  const keyboardRows: Array<Array<{ text: string; callback_data: string }>> = [];
  for (const task of tasks) {
    const toggleTo = task.isCompleted ? "0" : "1";
    const prefix = task.isCompleted ? "✅" : "⬜";
    const title = task.title.length > 36 ? `${task.title.slice(0, 36)}...` : task.title;
    keyboardRows.push([
      {
        text: `${prefix} ${title}`,
        callback_data: `chk:t:${task.id}:${toggleTo}`,
      },
    ]);
  }

  keyboardRows.push([
    { text: "🔄 Tải lại", callback_data: `chk:s:${shift.id}` },
    { text: "🏠 Menu", callback_data: "menu:main" },
  ]);

  const text = lines.join("\n");
  if (editTarget) {
    await editMessageText(chatId, editTarget.messageId, text, "HTML", {
      inline_keyboard: keyboardRows,
    });
  } else {
    await sendTelegramMessage(chatId.toString(), text, "HTML", {
      inline_keyboard: keyboardRows,
    });
  }
}

async function sendChecklist(chatId: number, user: LinkedUser, editTarget?: { messageId: number }) {
  const shift = await findChecklistShiftForUser(user.id);
  if (!shift) {
    const text = [
      "ℹ️ Không tìm thấy ca phù hợp để cập nhật checklist.",
      "Chỉ được check checklist trong vòng 2 giờ trước khi ca bắt đầu hoặc khi ca đang diễn ra.",
    ].join("\n");

    if (editTarget) {
      await editMessageText(chatId, editTarget.messageId, text, "HTML", buildBackToMainInlineKeyboard());
    } else {
      await sendTelegramMessage(chatId.toString(), text, "HTML", buildBackToMainInlineKeyboard());
    }
    return;
  }

  await sendChecklistForShift(chatId, user, shift.id, editTarget);
}

async function toggleChecklistTask(
  chatId: number,
  user: LinkedUser,
  taskId: string,
  nextValue: boolean,
  messageId: number
) {
  const task = await prisma.shiftTask.findUnique({
    where: { id: taskId },
    include: {
      shift: {
        include: {
          policy: { select: { teamId: true } },
        },
      },
    },
  });

  if (!task) {
    await sendTelegramMessage(chatId.toString(), "❌ Task không tồn tại.", "HTML");
    return;
  }

  const isAssignee = task.shift.assigneeId === user.id;
  const isManager = user.teamMembers.some(
    (m) => m.teamId === task.shift.policy.teamId && m.role === TeamRole.MANAGER
  );
  if (!isAssignee && !isManager) {
    await sendTelegramMessage(chatId.toString(), "❌ Bạn không có quyền cập nhật task này.", "HTML");
    return;
  }

  if (!isAssignee) {
    await sendTelegramMessage(
      chatId.toString(),
      "❌ Chỉ người trực của ca mới được check/uncheck checklist.",
      "HTML"
    );
    return;
  }

  const earliest = new Date(task.shift.startsAt.getTime() - 2 * 60 * 60 * 1000);
  if (new Date() < earliest) {
    await sendTelegramMessage(
      chatId.toString(),
      "❌ Chưa đến thời gian check checklist (chỉ được trước tối đa 2 giờ).",
      "HTML"
    );
    return;
  }

  await prisma.shiftTask.update({
    where: { id: taskId },
    data: {
      isCompleted: nextValue,
      completedAt: nextValue ? new Date() : null,
    },
  });

  await sendChecklistForShift(chatId, user, task.shiftId, { messageId });
}

async function sendSwapMenu(chatId: number, editTarget?: { messageId: number }) {
  const text = ["🔁 <b>Quản lý đổi ca</b>", "Chọn thao tác:"].join("\n");

  const keyboard = {
    inline_keyboard: [
      [{ text: "📤 Tạo yêu cầu đổi ca mở", callback_data: "sw:open:list" }],
      [{ text: "📥 Danh sách ca có thể nhận", callback_data: "sw:avail:list" }],
      [{ text: "🎯 Yêu cầu gửi đến tôi", callback_data: "sw:target:list" }],
      [{ text: "🧾 Yêu cầu của tôi", callback_data: "sw:mine:list" }],
      [{ text: "🏠 Menu chính", callback_data: "menu:main" }],
    ],
  };

  if (editTarget) {
    await editMessageText(chatId, editTarget.messageId, text, "HTML", keyboard);
  } else {
    await sendTelegramMessage(chatId.toString(), text, "HTML", keyboard);
  }
}

async function sendOpenSwapShiftList(chatId: number, user: LinkedUser, editTarget?: { messageId: number }) {
  const now = new Date();
  const shifts = await prisma.shift.findMany({
    where: {
      assigneeId: user.id,
      startsAt: { gte: new Date(now.getTime() - 60 * 60 * 1000) },
      status: { in: ACTIVE_SHIFT_STATUSES },
    },
    include: {
      policy: { select: { name: true, team: { select: { name: true } } } },
    },
    orderBy: { startsAt: "asc" },
    take: 10,
  });

  if (shifts.length === 0) {
    const text = "ℹ️ Bạn không có ca hợp lệ để tạo yêu cầu đổi ca mở.";
    if (editTarget) {
      await editMessageText(chatId, editTarget.messageId, text, "HTML", {
        inline_keyboard: [[{ text: "⬅️ Quay lại", callback_data: "sw:menu" }]],
      });
    } else {
      await sendTelegramMessage(chatId.toString(), text, "HTML");
    }
    return;
  }

  const lines = ["📤 <b>Chọn ca để tạo yêu cầu đổi ca mở</b>", ""];
  const keyboardRows: Array<Array<{ text: string; callback_data: string }>> = [];

  for (const shift of shifts) {
    lines.push(
      `• ${escapeHtml(shift.policy.team.name)} / ${escapeHtml(shift.policy.name)} - ${formatShiftRange(shift.startsAt, shift.endsAt)}`
    );
    keyboardRows.push([
      {
        text: `Tạo cho ca ${shortGuid(shift.id)}`,
        callback_data: `sw:open:create:${shift.id}`,
      },
    ]);
  }

  keyboardRows.push([{ text: "⬅️ Quay lại", callback_data: "sw:menu" }]);

  const text = lines.join("\n");
  if (editTarget) {
    await editMessageText(chatId, editTarget.messageId, text, "HTML", { inline_keyboard: keyboardRows });
  } else {
    await sendTelegramMessage(chatId.toString(), text, "HTML", { inline_keyboard: keyboardRows });
  }
}

async function createOpenSwap(chatId: number, user: LinkedUser, shiftId: string) {
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    include: { policy: { select: { name: true, team: { select: { name: true } } } } },
  });

  if (!shift || shift.assigneeId !== user.id) {
    await sendTelegramMessage(chatId.toString(), "❌ Không tìm thấy ca của bạn để tạo đổi ca.", "HTML");
    return;
  }

  if (!ACTIVE_SHIFT_STATUSES.includes(shift.status)) {
    await sendTelegramMessage(chatId.toString(), "❌ Ca này không ở trạng thái cho phép đổi.", "HTML");
    return;
  }

  const existing = await prisma.swapRequest.findFirst({
    where: {
      requesterId: user.id,
      originalShiftId: shift.id,
      status: SwapStatus.REQUESTED,
      targetUserId: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });

  if (existing) {
    await sendTelegramMessage(
      chatId.toString(),
      `ℹ️ Ca này đã có yêu cầu đổi mở (#${shortGuid(existing.id)}).`,
      "HTML"
    );
    return;
  }

  const created = await prisma.swapRequest.create({
    data: {
      requesterId: user.id,
      originalShiftId: shift.id,
      expiresAt: addDays(new Date(), 7),
      status: SwapStatus.REQUESTED,
    },
  });

  await sendTelegramMessage(
    chatId.toString(),
    [
      "✅ Tạo yêu cầu đổi ca mở thành công.",
      `ID: <code>${created.id}</code>`,
      `Ca: <b>${escapeHtml(shift.policy.team.name)} / ${escapeHtml(shift.policy.name)}</b>`,
      `${formatShiftRange(shift.startsAt, shift.endsAt)}`,
    ].join("\n"),
    "HTML",
    {
      inline_keyboard: [[{ text: "🧾 Xem yêu cầu của tôi", callback_data: "sw:mine:list" }]],
    }
  );
}

async function sendAvailableSwaps(chatId: number, user: LinkedUser, editTarget?: { messageId: number }) {
  const teamIds = user.teamMembers.map((m) => m.teamId);
  if (teamIds.length === 0) {
    const text = "ℹ️ Bạn chưa thuộc team nào nên không có đổi ca để nhận.";
    if (editTarget) {
      await editMessageText(chatId, editTarget.messageId, text, "HTML", {
        inline_keyboard: [[{ text: "⬅️ Quay lại", callback_data: "sw:menu" }]],
      });
    } else {
      await sendTelegramMessage(chatId.toString(), text, "HTML");
    }
    return;
  }

  const swaps = await prisma.swapRequest.findMany({
    where: {
      status: SwapStatus.REQUESTED,
      targetUserId: null,
      requesterId: { not: user.id },
      expiresAt: { gt: new Date() },
      originalShift: { policy: { teamId: { in: teamIds } } },
    },
    include: {
      requester: { select: { fullName: true } },
      originalShift: {
        include: {
          policy: { select: { name: true, teamId: true, timezone: true, team: { select: { name: true } } } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  if (swaps.length === 0) {
    const text = "ℹ️ Hiện tại không có yêu cầu đổi ca mở nào.";
    if (editTarget) {
      await editMessageText(chatId, editTarget.messageId, text, "HTML", {
        inline_keyboard: [[{ text: "⬅️ Quay lại", callback_data: "sw:menu" }]],
      });
    } else {
      await sendTelegramMessage(chatId.toString(), text, "HTML");
    }
    return;
  }

  const lines = ["📥 <b>Yêu cầu đổi ca mở</b>", ""];
  const keyboardRows: Array<Array<{ text: string; callback_data: string }>> = [];

  for (const swap of swaps) {
    lines.push(
      `• #${shortGuid(swap.id)} - ${escapeHtml(swap.originalShift.policy.team.name)} / ${escapeHtml(swap.originalShift.policy.name)}`,
      `  ${formatShiftRange(swap.originalShift.startsAt, swap.originalShift.endsAt)}`,
      `  Từ: ${escapeHtml(swap.requester.fullName)}`,
      ""
    );
    keyboardRows.push([
      { text: `Nhận #${shortGuid(swap.id)}`, callback_data: `sw:avail:take:${swap.id}` },
    ]);
  }

  keyboardRows.push([{ text: "⬅️ Quay lại", callback_data: "sw:menu" }]);

  if (editTarget) {
    await editMessageText(chatId, editTarget.messageId, lines.join("\n").trim(), "HTML", {
      inline_keyboard: keyboardRows,
    });
  } else {
    await sendTelegramMessage(chatId.toString(), lines.join("\n").trim(), "HTML", {
      inline_keyboard: keyboardRows,
    });
  }
}

async function takeOpenSwap(chatId: number, user: LinkedUser, swapId: string) {
  const swap = await prisma.swapRequest.findUnique({
    where: { id: swapId },
    include: {
      originalShift: { include: { policy: { select: { teamId: true, timezone: true } } } },
    },
  });

  if (!swap) {
    await sendTelegramMessage(chatId.toString(), "❌ Swap không tồn tại.", "HTML");
    return;
  }

  if (swap.targetUserId !== null || swap.requesterId === user.id) {
    await sendTelegramMessage(chatId.toString(), "❌ Swap này không hợp lệ để nhận.", "HTML");
    return;
  }

  if (swap.status !== SwapStatus.REQUESTED || swap.expiresAt <= new Date()) {
    await sendTelegramMessage(chatId.toString(), "❌ Swap này đã hết hạn hoặc đã thay đổi.", "HTML");
    return;
  }

  const inTeam = user.teamMembers.some((m) => m.teamId === swap.originalShift.policy.teamId);
  if (!inTeam) {
    await sendTelegramMessage(chatId.toString(), "❌ Bạn không thuộc team của ca này.", "HTML");
    return;
  }

  const crossPolicyConflict = await prisma.shift.findFirst({
    where: {
      assigneeId: user.id,
      policyId: { not: swap.originalShift.policyId },
      policy: { teamId: swap.originalShift.policy.teamId },
      status: { in: ACTIVE_SHIFT_STATUSES },
      startsAt: { lt: swap.originalShift.endsAt },
      endsAt: { gt: swap.originalShift.startsAt },
    },
    select: { id: true },
  });
  if (crossPolicyConflict) {
    await sendTelegramMessage(chatId.toString(), "❌ Bạn đã có ca khác policy bị trùng giờ.", "HTML");
    return;
  }

  const constraintViolation = await validateSwapAssignmentConstraints({
    userId: user.id,
    teamId: swap.originalShift.policy.teamId,
    startsAt: swap.originalShift.startsAt,
    endsAt: swap.originalShift.endsAt,
    timezone: swap.originalShift.policy.timezone,
    allowConsecutive: true,
    allowConsecutiveNight: true,
  });
  if (constraintViolation) {
    await sendTelegramMessage(chatId.toString(), `❌ ${escapeHtml(constraintViolation.message)}`, "HTML");
    return;
  }

  const updated = await prisma.swapRequest.updateMany({
    where: {
      id: swap.id,
      status: SwapStatus.REQUESTED,
      targetUserId: null,
      expiresAt: { gt: new Date() },
    },
    data: {
      targetUserId: user.id,
      status: SwapStatus.ACCEPTED_BY_TARGET,
      version: { increment: 1 },
    },
  });

  if (updated.count === 0) {
    await sendTelegramMessage(chatId.toString(), "❌ Swap vừa thay đổi bởi người khác.", "HTML");
    return;
  }

  await sendTelegramMessage(
    chatId.toString(),
    "✅ Bạn đã nhận swap. Đang chờ manager phê duyệt.",
    "HTML"
  );
}

async function sendTargetedSwaps(chatId: number, user: LinkedUser, editTarget?: { messageId: number }) {
  const swaps = await prisma.swapRequest.findMany({
    where: {
      targetUserId: user.id,
      status: SwapStatus.REQUESTED,
      expiresAt: { gt: new Date() },
    },
    include: {
      requester: { select: { fullName: true } },
      originalShift: {
        include: {
          policy: { select: { name: true, team: { select: { name: true } } } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  if (swaps.length === 0) {
    const text = "ℹ️ Không có yêu cầu đổi ca nào gửi đến bạn.";
    if (editTarget) {
      await editMessageText(chatId, editTarget.messageId, text, "HTML", {
        inline_keyboard: [[{ text: "⬅️ Quay lại", callback_data: "sw:menu" }]],
      });
    } else {
      await sendTelegramMessage(chatId.toString(), text, "HTML");
    }
    return;
  }

  const lines = ["🎯 <b>Yêu cầu đổi ca gửi đến bạn</b>", ""];
  const keyboardRows: Array<Array<{ text: string; callback_data: string }>> = [];

  for (const swap of swaps) {
    lines.push(
      `• #${shortGuid(swap.id)} - ${escapeHtml(swap.originalShift.policy.team.name)} / ${escapeHtml(swap.originalShift.policy.name)}`,
      `  ${formatShiftRange(swap.originalShift.startsAt, swap.originalShift.endsAt)}`,
      `  Người yêu cầu: ${escapeHtml(swap.requester.fullName)}`,
      ""
    );

    keyboardRows.push([
      { text: `Chấp nhận #${shortGuid(swap.id)}`, callback_data: `sw:target:accept:${swap.id}` },
      { text: `Từ chối #${shortGuid(swap.id)}`, callback_data: `sw:target:decline:${swap.id}` },
    ]);
  }

  keyboardRows.push([{ text: "⬅️ Quay lại", callback_data: "sw:menu" }]);

  if (editTarget) {
    await editMessageText(chatId, editTarget.messageId, lines.join("\n").trim(), "HTML", {
      inline_keyboard: keyboardRows,
    });
  } else {
    await sendTelegramMessage(chatId.toString(), lines.join("\n").trim(), "HTML", {
      inline_keyboard: keyboardRows,
    });
  }
}

async function respondTargetedSwap(chatId: number, user: LinkedUser, swapId: string, accept: boolean) {
  const swap = await prisma.swapRequest.findUnique({
    where: { id: swapId },
    include: {
      originalShift: { include: { policy: { select: { teamId: true, timezone: true } } } },
      targetShift: { select: { id: true } },
    },
  });

  if (!swap || swap.targetUserId !== user.id) {
    await sendTelegramMessage(chatId.toString(), "❌ Không tìm thấy yêu cầu đổi ca của bạn.", "HTML");
    return;
  }

  if (swap.status !== SwapStatus.REQUESTED || swap.expiresAt <= new Date()) {
    await sendTelegramMessage(chatId.toString(), "❌ Yêu cầu đổi ca này đã hết hạn hoặc đã xử lý.", "HTML");
    return;
  }

  if (accept) {
    const constraintViolation = await validateSwapAssignmentConstraints({
      userId: user.id,
      teamId: swap.originalShift.policy.teamId,
      startsAt: swap.originalShift.startsAt,
      endsAt: swap.originalShift.endsAt,
      timezone: swap.originalShift.policy.timezone,
      excludeShiftIds: swap.targetShift ? [swap.targetShift.id] : [],
      allowConsecutive: true,
      allowConsecutiveNight: true,
    });
    if (constraintViolation) {
      await sendTelegramMessage(chatId.toString(), `❌ ${escapeHtml(constraintViolation.message)}`, "HTML");
      return;
    }
  }

  const newStatus = accept ? SwapStatus.ACCEPTED_BY_TARGET : SwapStatus.REJECTED;
  const updated = await prisma.swapRequest.updateMany({
    where: {
      id: swap.id,
      targetUserId: user.id,
      status: SwapStatus.REQUESTED,
      expiresAt: { gt: new Date() },
    },
    data: {
      status: newStatus,
      version: { increment: 1 },
    },
  });

  if (updated.count === 0) {
    await sendTelegramMessage(chatId.toString(), "❌ Yêu cầu đã thay đổi. Hãy thử lại.", "HTML");
    return;
  }

  await sendTelegramMessage(
    chatId.toString(),
    accept
      ? "✅ Bạn đã chấp nhận yêu cầu đổi ca. Đang chờ manager phê duyệt."
      : "✅ Bạn đã từ chối yêu cầu đổi ca.",
    "HTML"
  );
}

async function sendMySwapRequests(chatId: number, user: LinkedUser, editTarget?: { messageId: number }) {
  const swaps = await prisma.swapRequest.findMany({
    where: {
      requesterId: user.id,
      status: SwapStatus.REQUESTED,
      expiresAt: { gt: new Date() },
    },
    include: {
      targetUser: { select: { fullName: true } },
      originalShift: {
        include: {
          policy: { select: { name: true, team: { select: { name: true } } } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  if (swaps.length === 0) {
    const text = "ℹ️ Bạn không có yêu cầu đổi ca đang mở nào.";
    if (editTarget) {
      await editMessageText(chatId, editTarget.messageId, text, "HTML", {
        inline_keyboard: [[{ text: "⬅️ Quay lại", callback_data: "sw:menu" }]],
      });
    } else {
      await sendTelegramMessage(chatId.toString(), text, "HTML");
    }
    return;
  }

  const lines = ["🧾 <b>Yêu cầu đổi ca của tôi</b>", ""];
  const keyboardRows: Array<Array<{ text: string; callback_data: string }>> = [];

  for (const swap of swaps) {
    lines.push(
      `• #${shortGuid(swap.id)} - ${escapeHtml(swap.originalShift.policy.team.name)} / ${escapeHtml(swap.originalShift.policy.name)}`,
      `  ${formatShiftRange(swap.originalShift.startsAt, swap.originalShift.endsAt)}`,
      `  Người nhận: ${escapeHtml(swap.targetUser?.fullName ?? "(mở)")}`,
      ""
    );
    keyboardRows.push([
      { text: `Hủy #${shortGuid(swap.id)}`, callback_data: `sw:mine:cancel:${swap.id}` },
    ]);
  }

  keyboardRows.push([{ text: "⬅️ Quay lại", callback_data: "sw:menu" }]);

  if (editTarget) {
    await editMessageText(chatId, editTarget.messageId, lines.join("\n").trim(), "HTML", {
      inline_keyboard: keyboardRows,
    });
  } else {
    await sendTelegramMessage(chatId.toString(), lines.join("\n").trim(), "HTML", {
      inline_keyboard: keyboardRows,
    });
  }
}

async function cancelMySwap(chatId: number, user: LinkedUser, swapId: string) {
  const updated = await prisma.swapRequest.updateMany({
    where: {
      id: swapId,
      requesterId: user.id,
      status: SwapStatus.REQUESTED,
    },
    data: {
      status: SwapStatus.CANCELLED,
      version: { increment: 1 },
    },
  });

  if (updated.count === 0) {
    await sendTelegramMessage(
      chatId.toString(),
      "❌ Không thể hủy yêu cầu (có thể đã được xử lý trước đó).",
      "HTML"
    );
    return;
  }

  await sendTelegramMessage(chatId.toString(), "✅ Đã hủy yêu cầu đổi ca.", "HTML");
}

async function sendReportShiftList(chatId: number, user: LinkedUser, editTarget?: { messageId: number }) {
  const now = new Date();
  const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const to = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);

  const shifts = await prisma.shift.findMany({
    where: {
      assigneeId: user.id,
      startsAt: { gte: from, lte: to },
      status: { in: [ShiftStatus.PUBLISHED, ShiftStatus.ACTIVE, ShiftStatus.COMPLETED] },
    },
    include: {
      policy: { select: { name: true, team: { select: { name: true } } } },
    },
    orderBy: { startsAt: "desc" },
    take: 12,
  });

  if (shifts.length === 0) {
    const text = "ℹ️ Không có ca nào để tạo report.";
    if (editTarget) {
      await editMessageText(chatId, editTarget.messageId, text, "HTML", {
        inline_keyboard: [[{ text: "⬅️ Quay lại", callback_data: "menu:main" }]],
      });
    } else {
      await sendTelegramMessage(chatId.toString(), text, "HTML");
    }
    return;
  }

  const lines = [
    "📝 <b>Chọn ca để tạo report</b>",
    "Sau khi chọn, bot gửi mẫu lệnh /report để bạn điền nhanh.",
    "",
  ];

  const keyboardRows: Array<Array<{ text: string; callback_data: string }>> = [];
  for (const shift of shifts) {
    lines.push(
      `• ${escapeHtml(shift.policy.team.name)} / ${escapeHtml(shift.policy.name)} - ${formatShiftRange(shift.startsAt, shift.endsAt)}`
    );
    keyboardRows.push([
      { text: `Report ca ${shortGuid(shift.id)}`, callback_data: `rpt:s:${shift.id}` },
    ]);
  }

  keyboardRows.push([{ text: "🏠 Menu chính", callback_data: "menu:main" }]);

  const text = lines.join("\n");
  if (editTarget) {
    await editMessageText(chatId, editTarget.messageId, text, "HTML", { inline_keyboard: keyboardRows });
  } else {
    await sendTelegramMessage(chatId.toString(), text, "HTML", { inline_keyboard: keyboardRows });
  }
}

async function sendReportTemplate(chatId: number, user: LinkedUser, shiftId: string) {
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    include: { policy: { select: { name: true, team: { select: { name: true } } } } },
  });

  if (!shift || shift.assigneeId !== user.id) {
    await sendTelegramMessage(chatId.toString(), "❌ Bạn chỉ có thể tạo report cho ca của chính bạn.", "HTML");
    return;
  }

  const template = [
    "📝 <b>Mẫu tạo report theo ca</b>",
    `Ca: <b>${escapeHtml(shift.policy.team.name)} / ${escapeHtml(shift.policy.name)}</b>`,
    `${formatShiftRange(shift.startsAt, shift.endsAt)}`,
    "",
    "Gửi theo cú pháp:",
    `<code>/report ${shift.id} | MEDIUM | Tiêu đề sự cố | Mô tả ngắn | Impact | Root cause | Action items</code>`,
    "",
    "Severity hợp lệ: LOW, MEDIUM, HIGH, CRITICAL",
  ].join("\n");

  await sendTelegramMessage(chatId.toString(), template, "HTML", {
    inline_keyboard: [[{ text: "🧾 Danh sach ca", callback_data: "rpt:list" }]],
  });
}

async function handleReportCommand(chatId: number, user: LinkedUser, payload: string | null) {
  if (!payload) {
    await sendTelegramMessage(
      chatId.toString(),
      [
        "📝 Dùng /report theo cú pháp:",
        "<code>/report &lt;shiftId&gt; | &lt;severity&gt; | &lt;title&gt; | &lt;description&gt; | &lt;impact&gt; | &lt;rootCause&gt; | &lt;actionItems&gt;</code>",
        "Ví dụ:",
        "<code>/report 11111111-1111-1111-1111-111111111111 | HIGH | API timeout | Ảnh hưởng login | 20% user lỗi | DB lock | Tăng kết nối + tối ưu query</code>",
      ].join("\n"),
      "HTML",
      {
        inline_keyboard: [[{ text: "Chọn ca để tạo report", callback_data: "rpt:list" }]],
      }
    );
    return;
  }

  const parts = payload.split("|").map((p) => p.trim());
  if (parts.length < 3) {
    await sendTelegramMessage(chatId.toString(), "❌ Thiếu dữ liệu. Cần ít nhất: shiftId | severity | title", "HTML");
    return;
  }

  const shiftId = parts[0];
  if (!isUuid(shiftId)) {
    await sendTelegramMessage(chatId.toString(), "❌ shiftId không hợp lệ.", "HTML");
    return;
  }

  const severityRaw = (parts[1] || "MEDIUM").toUpperCase();
  if (!isSeverity(severityRaw)) {
    await sendTelegramMessage(chatId.toString(), "❌ severity phải là LOW/MEDIUM/HIGH/CRITICAL.", "HTML");
    return;
  }
  const severity = severityRaw as IncidentSeverity;

  const title = parts[2];
  if (!title || title.length < 3) {
    await sendTelegramMessage(chatId.toString(), "❌ title phải tối thiểu 3 ký tự.", "HTML");
    return;
  }

  const description = parts[3] || null;
  const impactSummary = parts[4] || null;
  const rootCause = parts[5] || null;
  const actionItems = parts[6] || null;

  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    include: {
      policy: { select: { teamId: true, name: true, team: { select: { name: true } } } },
    },
  });

  if (!shift) {
    await sendTelegramMessage(chatId.toString(), "❌ Không tìm thấy shift.", "HTML");
    return;
  }

  if (shift.assigneeId !== user.id) {
    await sendTelegramMessage(chatId.toString(), "❌ Chỉ người trực của ca này mới được tạo report.", "HTML");
    return;
  }

  const incident = await prisma.$transaction(async (tx) => {
    const createdIncident = await tx.incident.create({
      data: {
        teamId: shift.policy.teamId,
        policyId: shift.policyId,
        shiftId: shift.id,
        title,
        description,
        severity,
        occurredAt: new Date(),
        createdById: user.id,
        assigneeId: shift.assigneeId,
        impactSummary,
        rootCause,
        actionItems,
      },
      select: { id: true },
    });

    await tx.incidentLifecycleEvent.create({
      data: {
        incidentId: createdIncident.id,
        fromStatus: null,
        toStatus: IncidentStatus.OPEN,
        changedById: user.id,
        note: "Tạo incident từ Telegram",
      },
    });

    return createdIncident;
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const lines = [
    "✅ Tạo report thành công.",
    `Incident ID: <code>${incident.id}</code>`,
    `Ca: <b>${escapeHtml(shift.policy.team.name)} / ${escapeHtml(shift.policy.name)}</b>`,
    `Severity: <b>${severityRaw}</b>`,
  ];
  if (appUrl) {
    lines.push(`Xem tổng hợp: <a href="${appUrl}/incidents">${appUrl}/incidents</a>`);
  }

  await sendTelegramMessage(chatId.toString(), lines.join("\n"), "HTML", {
    inline_keyboard: [[{ text: "📝 Tạo report tiếp", callback_data: "rpt:list" }]],
  });
}

function mapMenuShortcut(text: string):
  | "menu"
  | "myshifts"
  | "oncall"
  | "export"
  | "swaps"
  | "checklist"
  | "report"
  | "help"
  | null {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return null;

  if (
    normalized === "🏠 menu chính" ||
    normalized === "menu chính" ||
    normalized === "🏠 menu chinh" ||
    normalized === "menu chinh" ||
    normalized === "menu"
  ) {
    return "menu";
  }
  if (
    normalized === "📅 lịch trực của tôi" ||
    normalized === "lịch trực của tôi" 
  ) {
    return "myshifts";
  }
  if (
    normalized === "🟢 ca đang trực" ||
    normalized === "ca đang trực"
  ) {
    return "oncall";
  }
  if (
    normalized === "📤 xuất lịch" ||
    normalized === "xuất lịch" ||
    normalized === "xuat lich"
  ) {
    return "export";
  }
  if (
    normalized === "🔁 đổi ca" ||
    normalized === "đổi ca" 
  ) {
    return "swaps";
  }
  if (normalized === "✅ checklist" || normalized === "checklist") {
    return "checklist";
  }
  if (
    normalized === "📝 báo cáo" ||
    normalized === "báo cáo"
  ) {
    return "report";
  }
  if (
    normalized === "🆘 hỗ trợ" ||
    normalized === "hỗ trợ"
  ) {
    return "help";
  }

  return null;
}

async function handleLegacyCallbackActions(update: TelegramUpdate): Promise<boolean> {
  if (!update.callback_query) return false;

  const { id: cbId, data, message, from } = update.callback_query;
  if (!data || !message) {
    await answerCallbackQuery(cbId);
    return true;
  }

  const chatId = message.chat.id;
  const msgId = message.message_id;

  if (data.startsWith("proof-in:")) {
    const confirmationId = data.slice("proof-in:".length);
    const linked = await getLinkedUserByChatId(chatId);
    if (!linked) {
      await answerCallbackQuery(cbId, "Chat chưa liên kết tài khoản", true);
      return true;
    }

    const confirmation = await prisma.shiftConfirmation.findUnique({
      where: { id: confirmationId },
      include: { shift: { include: { policy: { select: { name: true } } } } },
    });
    if (!confirmation || confirmation.userId !== linked.id) {
      await answerCallbackQuery(cbId, "Không tìm thấy ca trực hợp lệ.", true);
      return true;
    }

    setPendingProofRequest(chatId, {
      userId: linked.id,
      kind: "CHECK_IN",
      confirmationId: confirmation.id,
      shiftId: confirmation.shiftId,
    });
    await answerCallbackQuery(cbId, "Đã bật chế độ nhận ảnh check-in");
    await sendTelegramMessage(
      chatId.toString(),
      [
        `📷 Hãy gửi ảnh check-in cho ca <b>${escapeHtml(confirmation.shift.policy.name)}</b>.`,
        `Bạn có thể gửi ngay ảnh không cần caption trong vòng 10 phút.`,
        `Hoặc gửi kèm caption: <code>checkin:${confirmation.id}</code>`,
      ].join("\n"),
      "HTML"
    );
    return true;
  }

  if (data.startsWith("proof-out:")) {
    const shiftId = data.slice("proof-out:".length);
    const linked = await getLinkedUserByChatId(chatId);
    if (!linked) {
      await answerCallbackQuery(cbId, "Chat chưa liên kết tài khoản", true);
      return true;
    }

    const shift = await prisma.shift.findUnique({
      where: { id: shiftId },
      include: { policy: { select: { name: true } } },
    });
    if (!shift || shift.assigneeId !== linked.id) {
      await answerCallbackQuery(cbId, "Không tìm thấy ca trực hợp lệ.", true);
      return true;
    }

    setPendingProofRequest(chatId, {
      userId: linked.id,
      kind: "CHECK_OUT",
      shiftId: shift.id,
    });
    await answerCallbackQuery(cbId, "Đã bật chế độ nhận ảnh check-out");
    await sendTelegramMessage(
      chatId.toString(),
      [
        `📷 Hãy gửi ảnh check-out cho ca <b>${escapeHtml(shift.policy.name)}</b>.`,
        `Bạn có thể gửi ngay ảnh không cần caption trong vòng 10 phút.`,
        `Hoặc gửi kèm caption: <code>checkout:${shift.id}</code>`,
      ].join("\n"),
      "HTML"
    );
    return true;
  }

  if (
    data.startsWith("confirm-id:") ||
    data.startsWith("decline-id:") ||
    data.startsWith("confirm:") ||
    data.startsWith("decline:")
  ) {
    const action = data.startsWith("confirm") ? "confirm" : "decline";
    const byId = data.startsWith("confirm-id:") || data.startsWith("decline-id:");
    const ref = data.slice(data.indexOf(":") + 1);

    const confirmation = await prisma.shiftConfirmation.findUnique({
      where: byId ? { id: ref } : { token: ref },
      include: {
        shift: {
          include: {
            assignee: { select: { id: true, fullName: true, telegramChatId: true } },
            policy: { select: { id: true, name: true, teamId: true } },
          },
        },
      },
    });

    if (!confirmation || confirmation.status !== ConfirmationStatus.PENDING) {
      await answerCallbackQuery(cbId, "Ca này đã được xử lý rồi.", true);
      return true;
    }

    const linked = await getLinkedUserByChatId(chatId);
    if (!linked || linked.id !== confirmation.userId) {
      await answerCallbackQuery(cbId, "Chỉ người trực của ca mới được xác nhận/từ chối.", true);
      return true;
    }

    if (new Date() > confirmation.dueAt) {
      await prisma.shiftConfirmation.update({
        where: { id: confirmation.id },
        data: { status: ConfirmationStatus.EXPIRED },
      });
      await answerCallbackQuery(cbId, "Xác nhận đã hết hạn.", true);
      return true;
    }

    if (action === "confirm") {
      const policyOptions = await getPolicyTelegramOptions(confirmation.shift.policy.id);
      if (policyOptions.requirePhotoOnConfirm) {
        const proofExists = await hasShiftProof({
          shiftId: confirmation.shiftId,
          userId: confirmation.userId,
          kind: "CHECK_IN",
        });
        if (!proofExists) {
          setPendingProofRequest(chatId, {
            userId: confirmation.userId,
            kind: "CHECK_IN",
            confirmationId: confirmation.id,
            shiftId: confirmation.shiftId,
          });
          await answerCallbackQuery(cbId, "Cần ảnh check-in trước khi xác nhận", true);
          await sendTelegramMessage(
            chatId.toString(),
            [
              "📷 Policy này yêu cầu ảnh check-in trước khi xác nhận ca.",
              "Hãy gửi ảnh ngay trong chat này (trong 10 phút).",
              `Hoặc caption: <code>checkin:${confirmation.id}</code>`,
            ].join("\n"),
            "HTML"
          );
          return true;
        }
      }
    }

    const actorLabel = from.first_name ?? "Telegram user";
    const result = await applyConfirmationAction({
      confirmation: {
        id: confirmation.id,
        shiftId: confirmation.shiftId,
        userId: confirmation.userId,
        status: confirmation.status,
        shift: {
          startsAt: confirmation.shift.startsAt,
          endsAt: confirmation.shift.endsAt,
          assignee: { fullName: confirmation.shift.assignee.fullName },
          policy: {
            name: confirmation.shift.policy.name,
            teamId: confirmation.shift.policy.teamId,
          },
        },
      },
      action,
      actorLabel,
    });

    await editMessageText(chatId, msgId, result.updatedText, "HTML", { inline_keyboard: [] }).catch(() => {});
    await answerCallbackQuery(cbId, `${result.icon} ${result.label} thành công!`);
    return true;
  }
  if (data.startsWith("ack:")) {
    const alertId = data.slice(4);

    const alert = await prisma.alert.findUnique({ where: { id: alertId } });
    if (!alert || alert.status !== "FIRING") {
      await answerCallbackQuery(cbId, "Cảnh báo này đã được xử lý rồi.", true);
      return true;
    }

    const telegramUser = await prisma.user.findFirst({
      where: { telegramChatId: BigInt(chatId) },
      select: { id: true, fullName: true },
    });

    await prisma.alert.update({
      where: { id: alertId },
      data: {
        status: "ACKNOWLEDGED",
        ...(telegramUser ? { acknowledgedById: telegramUser.id } : {}),
      },
    });

    const ackLabel = telegramUser?.fullName ?? from.first_name ?? "ai do";
    const updatedText = [
      "👍 <b>Cảnh báo đã được nhận</b>",
      "",
      `<b>${escapeHtml(alert.title)}</b>`,
      ...(alert.message ? [escapeHtml(alert.message), ""] : []),
      `Nhận bởi: <b>${escapeHtml(ackLabel)}</b>`,
    ].join("\n");

    await editMessageText(chatId, msgId, updatedText, "HTML", { inline_keyboard: [] });
    await answerCallbackQuery(cbId, `👍 Đã nhận bởi ${ackLabel}`);
    return true;
  }

  return false;
}

async function handleMenuCallback(update: TelegramUpdate): Promise<boolean> {
  const cb = update.callback_query;
  if (!cb?.data || !cb.message) return false;

  const data = cb.data;
  const chatId = cb.message.chat.id;
  const messageId = cb.message.message_id;

  if (
    !(data.startsWith("menu:") ||
      data.startsWith("chk:") ||
      data.startsWith("sw:") ||
      data.startsWith("rpt:") ||
      data.startsWith("exp:"))
  ) {
    return false;
  }

  const user = await requireLinkedUser(chatId);
  if (!user) {
    await answerCallbackQuery(cb.id, "Chat chưa liên kết tài khoản", true);
    return true;
  }

  try {
    if (data === "menu:main") {
      await answerCallbackQuery(cb.id);
      await sendMainMenu(chatId, user.fullName);
      await sendMainMenuInline(chatId);
      return true;
    }

    if (data === "menu:shifts") {
      await answerCallbackQuery(cb.id);
      await sendMyShifts(chatId, user);
      return true;
    }

    if (data === "menu:oncall") {
      await answerCallbackQuery(cb.id);
      await sendOncallNow(chatId);
      return true;
    }

    if (data === "menu:swaps" || data === "sw:menu") {
      await answerCallbackQuery(cb.id);
      await sendSwapMenu(chatId, { messageId });
      return true;
    }

    if (data === "menu:checklist") {
      await answerCallbackQuery(cb.id);
      await sendChecklist(chatId, user, { messageId });
      return true;
    }

    if (data === "menu:report" || data === "rpt:list") {
      await answerCallbackQuery(cb.id);
      await sendReportShiftList(chatId, user, { messageId });
      return true;
    }

    if (data === "menu:export") {
      await answerCallbackQuery(cb.id);
      await sendExportMenu(chatId, user, { messageId });
      return true;
    }

    if (data === "menu:help") {
      await answerCallbackQuery(cb.id);
      await editMessageText(chatId, messageId, supportText(), "HTML", buildBackToMainInlineKeyboard());
      return true;
    }

    if (data === "sw:open:list") {
      await answerCallbackQuery(cb.id);
      await sendOpenSwapShiftList(chatId, user, { messageId });
      return true;
    }

    if (data.startsWith("sw:open:create:")) {
      const shiftId = data.slice("sw:open:create:".length);
      await answerCallbackQuery(cb.id);
      await createOpenSwap(chatId, user, shiftId);
      return true;
    }

    if (data === "sw:avail:list") {
      await answerCallbackQuery(cb.id);
      await sendAvailableSwaps(chatId, user, { messageId });
      return true;
    }

    if (data.startsWith("sw:avail:take:")) {
      const swapId = data.slice("sw:avail:take:".length);
      await answerCallbackQuery(cb.id);
      await takeOpenSwap(chatId, user, swapId);
      return true;
    }

    if (data === "sw:target:list") {
      await answerCallbackQuery(cb.id);
      await sendTargetedSwaps(chatId, user, { messageId });
      return true;
    }

    if (data.startsWith("sw:target:accept:")) {
      const swapId = data.slice("sw:target:accept:".length);
      await answerCallbackQuery(cb.id);
      await respondTargetedSwap(chatId, user, swapId, true);
      return true;
    }

    if (data.startsWith("sw:target:decline:")) {
      const swapId = data.slice("sw:target:decline:".length);
      await answerCallbackQuery(cb.id);
      await respondTargetedSwap(chatId, user, swapId, false);
      return true;
    }

    if (data === "sw:mine:list") {
      await answerCallbackQuery(cb.id);
      await sendMySwapRequests(chatId, user, { messageId });
      return true;
    }

    if (data.startsWith("sw:mine:cancel:")) {
      const swapId = data.slice("sw:mine:cancel:".length);
      await answerCallbackQuery(cb.id);
      await cancelMySwap(chatId, user, swapId);
      return true;
    }

    if (data === "chk:cur") {
      await answerCallbackQuery(cb.id);
      await sendChecklist(chatId, user, { messageId });
      return true;
    }

    if (data.startsWith("chk:s:")) {
      const shiftId = data.slice("chk:s:".length);
      await answerCallbackQuery(cb.id);
      await sendChecklistForShift(chatId, user, shiftId, { messageId });
      return true;
    }

    if (data.startsWith("chk:t:")) {
      const [, , taskId, rawNext] = data.split(":");
      if (!taskId || (rawNext !== "0" && rawNext !== "1")) {
        await answerCallbackQuery(cb.id, "Task action không hợp lệ", true);
        return true;
      }
      await answerCallbackQuery(cb.id);
      await toggleChecklistTask(chatId, user, taskId, rawNext === "1", messageId);
      return true;
    }

    if (data.startsWith("rpt:s:")) {
      const shiftId = data.slice("rpt:s:".length);
      await answerCallbackQuery(cb.id);
      await sendReportTemplate(chatId, user, shiftId);
      return true;
    }

    if (data.startsWith("exp:")) {
      const [, rawFormat, rawMonth] = data.split(":");
      const normalizedFormat = rawFormat?.toLowerCase();
      if (!normalizedFormat || !rawMonth) {
        await answerCallbackQuery(cb.id, "Export action không hợp lệ", true);
        return true;
      }

      if (normalizedFormat !== "csv" && normalizedFormat !== "excel") {
        await answerCallbackQuery(cb.id, "Định dạng export không hợp lệ", true);
        return true;
      }

      await answerCallbackQuery(cb.id, "Đang tạo file export...");
      await sendScheduleExportDocument(chatId, user, normalizedFormat, rawMonth);
      return true;
    }

    await answerCallbackQuery(cb.id);
    return true;
  } catch (error) {
    console.error("[telegram] callback handler error:", error);
    await answerCallbackQuery(cb.id, "Có lỗi khi xử lý thao tác", true).catch(() => {});
    return true;
  }
}

async function handleTextCommand(update: TelegramUpdate): Promise<void> {
  const message = update.message;
  if (!message?.from) return;

  const chatId = message.chat.id;
  const text = message.text?.trim() ?? "";
  const parsedCommand = text ? parseCommandPayload(text) : null;

  if (parsedCommand && (parsedCommand.command === "start" || parsedCommand.command === "link")) {
    if (parsedCommand.payload) {
      const linkedUser = await linkTelegramByToken(chatId, parsedCommand.payload);
      if (linkedUser) {
        await sendTelegramMessage(
          chatId.toString(),
          [
            `✅ Tài khoản <b>${escapeHtml(linkedUser.fullName)}</b> đã liên kết thành công!`,
            "Nhập <code>/menu</code> để mở menu chính.",
          ].join("\n"),
          "HTML",
          REMOVE_REPLY_KEYBOARD
        );
      } else {
        const existingLinkedUser = await prisma.user.findFirst({
          where: { telegramChatId: BigInt(chatId) },
          select: { fullName: true },
        });

        if (existingLinkedUser) {
          await sendTelegramMessage(
            chatId.toString(),
            [
              `ℹ️ Chat này đang liên kết với tài khoản <b>${escapeHtml(existingLinkedUser.fullName)}</b>.`,
              "Nhập <code>/menu</code> để mở menu chính.",
            ].join("\n"),
            "HTML",
            REMOVE_REPLY_KEYBOARD
          );
          return;
        }

        await sendTelegramMessage(
          chatId.toString(),
          [
            "❌ Mã liên kết không hợp lệ hoặc đã hết hạn (10 phút).",
            "Vui lòng vào ứng dụng -> Hồ sơ -> Kết nối Telegram để tạo mã mới.",
            "Sau đó gửi lại: <code>/link &lt;mã_liên_kết&gt;</code>",
          ].join("\n"),
          "HTML",
          REMOVE_REPLY_KEYBOARD
        );
      }
      return;
    }

    const linkedUser = await getLinkedUserByChatId(chatId);
    if (linkedUser) {
      await sendTelegramMessage(
        chatId.toString(),
        [
          `👋 Xin chào <b>${escapeHtml(linkedUser.fullName)}</b>!`,
          "Tài khoản đã liên kết. Nhập <code>/menu</code> để mở menu chính.",
        ].join("\n"),
        "HTML",
        REMOVE_REPLY_KEYBOARD
      );
    } else {
      await sendTelegramMessage(
        chatId.toString(),
        [
          "👋 Xin chào! Để liên kết Telegram:",
          "1) Vào ứng dụng -> Hồ sơ -> Kết nối Telegram",
          "2) Gửi: <code>/link &lt;mã_liên_kết&gt;</code>",
        ].join("\n"),
        "HTML",
        REMOVE_REPLY_KEYBOARD
      );
    }
    return;
  }

  if (!parsedCommand && text) {
    const shortcut = mapMenuShortcut(text);
    if (shortcut) {
      const linked = await requireLinkedUser(chatId);
      if (!linked) return;

      if (shortcut === "menu") {
        await sendMainMenu(chatId, linked.fullName);
        await sendMainMenuInline(chatId);
        return;
      }
      if (shortcut === "myshifts") {
        await sendMyShifts(chatId, linked);
        return;
      }
      if (shortcut === "oncall") {
        await sendOncallNow(chatId);
        return;
      }
      if (shortcut === "export") {
        await sendExportMenu(chatId, linked);
        return;
      }
      if (shortcut === "swaps") {
        await sendSwapMenu(chatId);
        return;
      }
      if (shortcut === "checklist") {
        await sendChecklist(chatId, linked);
        return;
      }
      if (shortcut === "report") {
        await sendReportShiftList(chatId, linked);
        return;
      }
      if (shortcut === "help") {
        await sendTelegramMessage(chatId.toString(), supportText(), "HTML", buildBackToMainInlineKeyboard());
        return;
      }
    }
  }

  if (!parsedCommand) return;

  const linked = await requireLinkedUser(chatId);
  if (!linked) return;

  switch (parsedCommand.command) {
    case "menu":
      await sendMainMenu(chatId, linked.fullName);
      await sendMainMenuInline(chatId);
      return;
    case "oncall":
    case "status":
      await sendOncallNow(chatId);
      return;
    case "myshifts":
      await sendMyShifts(chatId, linked);
      return;
    case "export": {
      const parsedExport = parseExportCommandPayload(parsedCommand.payload);
      if (parsedExport.error) {
        await sendTelegramMessage(chatId.toString(), `❌ ${parsedExport.error}`, "HTML");
        return;
      }
      if (!parsedExport.format) {
        await sendExportMenu(chatId, linked);
        return;
      }
      await sendScheduleExportDocument(chatId, linked, parsedExport.format, parsedExport.monthToken);
      return;
    }
    case "exportcsv": {
      const monthToken = parsedCommand.payload?.trim() || null;
      if (monthToken && !parseMonthToken(monthToken)) {
        await sendTelegramMessage(
          chatId.toString(),
          "❌ Tháng không hợp lệ. Dùng định dạng <code>YYYY-MM</code>, ví dụ <code>2026-05</code>.",
          "HTML"
        );
        return;
      }
      await sendScheduleExportDocument(chatId, linked, "csv", monthToken);
      return;
    }
    case "exportexcel": {
      const monthToken = parsedCommand.payload?.trim() || null;
      if (monthToken && !parseMonthToken(monthToken)) {
        await sendTelegramMessage(
          chatId.toString(),
          "❌ Tháng không hợp lệ. Dùng định dạng <code>YYYY-MM</code>, ví dụ <code>2026-05</code>.",
          "HTML"
        );
        return;
      }
      await sendScheduleExportDocument(chatId, linked, "excel", monthToken);
      return;
    }
    case "checklist":
      await sendChecklist(chatId, linked);
      return;
    case "swaps":
      await sendSwapMenu(chatId);
      return;
    case "report":
      await handleReportCommand(chatId, linked, parsedCommand.payload);
      return;
    case "help":
      await sendTelegramMessage(chatId.toString(), supportText(), "HTML", buildBackToMainInlineKeyboard());
      return;
    default:
      await sendTelegramMessage(
        chatId.toString(),
        "ℹ️ Lệnh không được hỗ trợ. Dùng /menu hoặc /export để mở danh sách chức năng.",
        "HTML"
      );
  }
}

export async function processTelegramUpdate(update: TelegramUpdate): Promise<void> {
  const legacyHandled = await handleLegacyCallbackActions(update);
  if (legacyHandled) return;

  const menuHandled = await handleMenuCallback(update);
  if (menuHandled) return;

  const proofHandled = await handleProofPhotoMessage(update);
  if (proofHandled) return;

  await handleTextCommand(update);
}
