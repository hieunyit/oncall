import {
  ChannelType,
  ConfirmationStatus,
  DeliveryStatus,
  IncidentSeverity,
  IncidentStatus,
  ShiftStatus,
  SwapStatus,
  TeamRole,
} from "@/app/generated/prisma/client";
import { addDays } from "date-fns";
import {
  answerCallbackQuery,
  editMessageText,
  editTelegramDeliveries,
  sendTelegramMessage,
  TelegramUpdate,
} from "@/lib/notifications/telegram";
import { prisma } from "@/lib/prisma";
import { validateSwapAssignmentConstraints } from "@/lib/rotation/swap-constraints";
import {
  buildBackToMainInlineKeyboard,
  buildMainMenuInlineKeyboard,
  buildMainMenuReplyKeyboard,
} from "@/lib/telegram/bot-config";

const TZ = "Asia/Ho_Chi_Minh";
const ACTIVE_SHIFT_STATUSES: ShiftStatus[] = [ShiftStatus.PUBLISHED, ShiftStatus.ACTIVE];

type LinkedUser = {
  id: string;
  fullName: string;
  teamMembers: Array<{ teamId: string; role: TeamRole }>;
};

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
    "<b>Ho tro</b>",
    "- Neu can ho tro, lien he quan tri he thong.",
    "- Dung /menu de quay lai menu chinh.",
  ].join("\n");
}

async function getLinkedUserByChatId(chatId: number): Promise<LinkedUser | null> {
  return prisma.user.findFirst({
    where: { telegramChatId: BigInt(chatId) },
    select: {
      id: true,
      fullName: true,
      teamMembers: {
        select: { teamId: true, role: true },
      },
    },
  });
}

async function sendMainMenu(chatId: number, userName?: string) {
  const intro = [
    `👋 Xin chao${userName ? ` <b>${escapeHtml(userName)}</b>` : ""}!`,
    "Chon chuc nang ben duoi hoac dung command:",
    "/oncall, /myshifts, /checklist, /swaps, /report, /help",
  ].join("\n");

  await sendTelegramMessage(
    chatId.toString(),
    intro,
    "HTML",
    buildMainMenuReplyKeyboard()
  );
}

async function sendMainMenuInline(chatId: number) {
  await sendTelegramMessage(
    chatId.toString(),
    "<b>Menu chinh</b>\nChon tinh nang:",
    "HTML",
    buildMainMenuInlineKeyboard()
  );
}

async function requireLinkedUser(chatId: number): Promise<LinkedUser | null> {
  const linked = await getLinkedUserByChatId(chatId);
  if (linked) return linked;

  await sendTelegramMessage(
    chatId.toString(),
    [
      "❌ Chat nay chua lien ket tai khoan On-Call.",
      "Vao ung dung -> Ho so -> Ket noi Telegram de tao ma lien ket.",
      "Sau do gui: <code>/link &lt;ma_lien_ket&gt;</code>",
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
      "ℹ️ Hien tai khong co ca nao dang truc.",
      "HTML",
      buildBackToMainInlineKeyboard()
    );
    return;
  }

  const lines = ["🟢 <b>Ca dang truc</b>", ""];
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
      confirmation: { select: { status: true } },
    },
    orderBy: { startsAt: "asc" },
    take: 20,
  });

  if (shifts.length === 0) {
    await sendTelegramMessage(
      chatId.toString(),
      "ℹ️ Ban chua co ca truc trong 7 ngay gan nhat/ke tiep.",
      "HTML",
      buildBackToMainInlineKeyboard()
    );
    return;
  }

  const lines = ["📅 <b>Lich truc cua toi</b>", ""];
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

  await sendTelegramMessage(
    chatId.toString(),
    lines.join("\n").trim(),
    "HTML",
    {
      inline_keyboard: [
        [
          { text: "✅ Checklist", callback_data: "menu:checklist" },
          { text: "🔁 Doi ca", callback_data: "menu:swaps" },
        ],
        [
          { text: "📝 Bao cao", callback_data: "menu:report" },
          { text: "🏠 Menu chinh", callback_data: "menu:main" },
        ],
      ],
    }
  );
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
    await sendTelegramMessage(chatId.toString(), "❌ Khong tim thay ca truc.", "HTML");
    return;
  }

  const isAssignee = shift.assigneeId === user.id;
  const isManager = user.teamMembers.some(
    (m) => m.teamId === shift.policy.teamId && m.role === TeamRole.MANAGER
  );

  if (!isAssignee && !isManager) {
    await sendTelegramMessage(chatId.toString(), "❌ Ban khong co quyen xem checklist ca nay.", "HTML");
    return;
  }

  const tasks = await ensureShiftTasksSeeded(shift.id, shift.policy.id);

  const done = tasks.filter((t) => t.isCompleted).length;
  const total = tasks.length;

  const lines = [
    "✅ <b>Checklist ca truc</b>",
    `Ca: <b>${escapeHtml(shift.policy.team.name)} / ${escapeHtml(shift.policy.name)}</b>`,
    `Nguoi truc: <b>${escapeHtml(shift.assignee.fullName)}</b>`,
    `${formatShiftRange(shift.startsAt, shift.endsAt)}`,
    `Tien do: <b>${done}/${total}</b>`,
    "",
  ];

  if (tasks.length === 0) {
    lines.push("(Chua co checklist cho ca nay)");
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
    { text: "🔄 Tai lai", callback_data: `chk:s:${shift.id}` },
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
      "ℹ️ Khong tim thay ca phu hop de cap nhat checklist.",
      "Chi duoc check checklist trong vong 2 gio truoc khi ca bat dau hoac khi ca dang dien ra.",
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
    await sendTelegramMessage(chatId.toString(), "❌ Task khong ton tai.", "HTML");
    return;
  }

  const isAssignee = task.shift.assigneeId === user.id;
  const isManager = user.teamMembers.some(
    (m) => m.teamId === task.shift.policy.teamId && m.role === TeamRole.MANAGER
  );
  if (!isAssignee && !isManager) {
    await sendTelegramMessage(chatId.toString(), "❌ Ban khong co quyen cap nhat task nay.", "HTML");
    return;
  }

  if (!isAssignee) {
    await sendTelegramMessage(
      chatId.toString(),
      "❌ Chi nguoi truc cua ca moi duoc check/uncheck checklist.",
      "HTML"
    );
    return;
  }

  const earliest = new Date(task.shift.startsAt.getTime() - 2 * 60 * 60 * 1000);
  if (new Date() < earliest) {
    await sendTelegramMessage(
      chatId.toString(),
      "❌ Chua den thoi gian check checklist (chi duoc truoc toi da 2 gio).",
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
  const text = ["🔁 <b>Quan ly doi ca</b>", "Chon thao tac:"].join("\n");

  const keyboard = {
    inline_keyboard: [
      [{ text: "📤 Tao yeu cau doi ca mo", callback_data: "sw:open:list" }],
      [{ text: "📥 Danh sach ca co the nhan", callback_data: "sw:avail:list" }],
      [{ text: "🎯 Yeu cau gui den toi", callback_data: "sw:target:list" }],
      [{ text: "🧾 Yeu cau cua toi", callback_data: "sw:mine:list" }],
      [{ text: "🏠 Menu chinh", callback_data: "menu:main" }],
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
    const text = "ℹ️ Ban khong co ca hop le de tao yeu cau doi ca mo.";
    if (editTarget) {
      await editMessageText(chatId, editTarget.messageId, text, "HTML", {
        inline_keyboard: [[{ text: "⬅️ Quay lai", callback_data: "sw:menu" }]],
      });
    } else {
      await sendTelegramMessage(chatId.toString(), text, "HTML");
    }
    return;
  }

  const lines = ["📤 <b>Chon ca de tao yeu cau doi ca mo</b>", ""];
  const keyboardRows: Array<Array<{ text: string; callback_data: string }>> = [];

  for (const shift of shifts) {
    lines.push(
      `• ${escapeHtml(shift.policy.team.name)} / ${escapeHtml(shift.policy.name)} - ${formatShiftRange(shift.startsAt, shift.endsAt)}`
    );
    keyboardRows.push([
      {
        text: `Tao cho ca ${shortGuid(shift.id)}`,
        callback_data: `sw:open:create:${shift.id}`,
      },
    ]);
  }

  keyboardRows.push([{ text: "⬅️ Quay lai", callback_data: "sw:menu" }]);

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
    await sendTelegramMessage(chatId.toString(), "❌ Khong tim thay ca cua ban de tao doi ca.", "HTML");
    return;
  }

  if (!ACTIVE_SHIFT_STATUSES.includes(shift.status)) {
    await sendTelegramMessage(chatId.toString(), "❌ Ca nay khong o trang thai cho phep doi.", "HTML");
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
      `ℹ️ Ca nay da co yeu cau doi mo (#${shortGuid(existing.id)}).`,
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
      "✅ Tao yeu cau doi ca mo thanh cong.",
      `ID: <code>${created.id}</code>`,
      `Ca: <b>${escapeHtml(shift.policy.team.name)} / ${escapeHtml(shift.policy.name)}</b>`,
      `${formatShiftRange(shift.startsAt, shift.endsAt)}`,
    ].join("\n"),
    "HTML",
    {
      inline_keyboard: [[{ text: "🧾 Xem yeu cau cua toi", callback_data: "sw:mine:list" }]],
    }
  );
}

async function sendAvailableSwaps(chatId: number, user: LinkedUser, editTarget?: { messageId: number }) {
  const teamIds = user.teamMembers.map((m) => m.teamId);
  if (teamIds.length === 0) {
    const text = "ℹ️ Ban chua thuoc team nao nen khong co doi ca de nhan.";
    if (editTarget) {
      await editMessageText(chatId, editTarget.messageId, text, "HTML", {
        inline_keyboard: [[{ text: "⬅️ Quay lai", callback_data: "sw:menu" }]],
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
    const text = "ℹ️ Hien tai khong co yeu cau doi ca mo nao.";
    if (editTarget) {
      await editMessageText(chatId, editTarget.messageId, text, "HTML", {
        inline_keyboard: [[{ text: "⬅️ Quay lai", callback_data: "sw:menu" }]],
      });
    } else {
      await sendTelegramMessage(chatId.toString(), text, "HTML");
    }
    return;
  }

  const lines = ["📥 <b>Yeu cau doi ca mo</b>", ""];
  const keyboardRows: Array<Array<{ text: string; callback_data: string }>> = [];

  for (const swap of swaps) {
    lines.push(
      `• #${shortGuid(swap.id)} - ${escapeHtml(swap.originalShift.policy.team.name)} / ${escapeHtml(swap.originalShift.policy.name)}`,
      `  ${formatShiftRange(swap.originalShift.startsAt, swap.originalShift.endsAt)}`,
      `  Tu: ${escapeHtml(swap.requester.fullName)}`,
      ""
    );
    keyboardRows.push([
      { text: `Nhan #${shortGuid(swap.id)}`, callback_data: `sw:avail:take:${swap.id}` },
    ]);
  }

  keyboardRows.push([{ text: "⬅️ Quay lai", callback_data: "sw:menu" }]);

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
    await sendTelegramMessage(chatId.toString(), "❌ Swap khong ton tai.", "HTML");
    return;
  }

  if (swap.targetUserId !== null || swap.requesterId === user.id) {
    await sendTelegramMessage(chatId.toString(), "❌ Swap nay khong hop le de nhan.", "HTML");
    return;
  }

  if (swap.status !== SwapStatus.REQUESTED || swap.expiresAt <= new Date()) {
    await sendTelegramMessage(chatId.toString(), "❌ Swap nay da het han hoac da thay doi.", "HTML");
    return;
  }

  const inTeam = user.teamMembers.some((m) => m.teamId === swap.originalShift.policy.teamId);
  if (!inTeam) {
    await sendTelegramMessage(chatId.toString(), "❌ Ban khong thuoc team cua ca nay.", "HTML");
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
    await sendTelegramMessage(chatId.toString(), "❌ Ban da co ca khac policy bi trung gio.", "HTML");
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
    await sendTelegramMessage(chatId.toString(), "❌ Swap vua thay doi boi nguoi khac.", "HTML");
    return;
  }

  await sendTelegramMessage(
    chatId.toString(),
    "✅ Ban da nhan swap. Dang cho manager phe duyet.",
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
    const text = "ℹ️ Khong co yeu cau doi ca nao gui den ban.";
    if (editTarget) {
      await editMessageText(chatId, editTarget.messageId, text, "HTML", {
        inline_keyboard: [[{ text: "⬅️ Quay lai", callback_data: "sw:menu" }]],
      });
    } else {
      await sendTelegramMessage(chatId.toString(), text, "HTML");
    }
    return;
  }

  const lines = ["🎯 <b>Yeu cau doi ca gui den ban</b>", ""];
  const keyboardRows: Array<Array<{ text: string; callback_data: string }>> = [];

  for (const swap of swaps) {
    lines.push(
      `• #${shortGuid(swap.id)} - ${escapeHtml(swap.originalShift.policy.team.name)} / ${escapeHtml(swap.originalShift.policy.name)}`,
      `  ${formatShiftRange(swap.originalShift.startsAt, swap.originalShift.endsAt)}`,
      `  Nguoi yeu cau: ${escapeHtml(swap.requester.fullName)}`,
      ""
    );

    keyboardRows.push([
      { text: `Chap nhan #${shortGuid(swap.id)}`, callback_data: `sw:target:accept:${swap.id}` },
      { text: `Tu choi #${shortGuid(swap.id)}`, callback_data: `sw:target:decline:${swap.id}` },
    ]);
  }

  keyboardRows.push([{ text: "⬅️ Quay lai", callback_data: "sw:menu" }]);

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
    await sendTelegramMessage(chatId.toString(), "❌ Khong tim thay yeu cau doi ca cua ban.", "HTML");
    return;
  }

  if (swap.status !== SwapStatus.REQUESTED || swap.expiresAt <= new Date()) {
    await sendTelegramMessage(chatId.toString(), "❌ Yeu cau doi ca nay da het han hoac da xu ly.", "HTML");
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
    await sendTelegramMessage(chatId.toString(), "❌ Yeu cau da thay doi. Hay thu lai.", "HTML");
    return;
  }

  await sendTelegramMessage(
    chatId.toString(),
    accept
      ? "✅ Ban da chap nhan yeu cau doi ca. Dang cho manager phe duyet."
      : "✅ Ban da tu choi yeu cau doi ca.",
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
    const text = "ℹ️ Ban khong co yeu cau doi ca dang mo nao.";
    if (editTarget) {
      await editMessageText(chatId, editTarget.messageId, text, "HTML", {
        inline_keyboard: [[{ text: "⬅️ Quay lai", callback_data: "sw:menu" }]],
      });
    } else {
      await sendTelegramMessage(chatId.toString(), text, "HTML");
    }
    return;
  }

  const lines = ["🧾 <b>Yeu cau doi ca cua toi</b>", ""];
  const keyboardRows: Array<Array<{ text: string; callback_data: string }>> = [];

  for (const swap of swaps) {
    lines.push(
      `• #${shortGuid(swap.id)} - ${escapeHtml(swap.originalShift.policy.team.name)} / ${escapeHtml(swap.originalShift.policy.name)}`,
      `  ${formatShiftRange(swap.originalShift.startsAt, swap.originalShift.endsAt)}`,
      `  Target: ${escapeHtml(swap.targetUser?.fullName ?? "(mo)")}`,
      ""
    );
    keyboardRows.push([
      { text: `Huy #${shortGuid(swap.id)}`, callback_data: `sw:mine:cancel:${swap.id}` },
    ]);
  }

  keyboardRows.push([{ text: "⬅️ Quay lai", callback_data: "sw:menu" }]);

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
      "❌ Khong the huy yeu cau (co the da duoc xu ly truoc do).",
      "HTML"
    );
    return;
  }

  await sendTelegramMessage(chatId.toString(), "✅ Da huy yeu cau doi ca.", "HTML");
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
    const text = "ℹ️ Khong co ca nao de tao report.";
    if (editTarget) {
      await editMessageText(chatId, editTarget.messageId, text, "HTML", {
        inline_keyboard: [[{ text: "⬅️ Quay lai", callback_data: "menu:main" }]],
      });
    } else {
      await sendTelegramMessage(chatId.toString(), text, "HTML");
    }
    return;
  }

  const lines = [
    "📝 <b>Chon ca de tao report</b>",
    "Sau khi chon, bot gui mau lenh /report de ban dien nhanh.",
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

  keyboardRows.push([{ text: "🏠 Menu chinh", callback_data: "menu:main" }]);

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
    await sendTelegramMessage(chatId.toString(), "❌ Ban chi co the tao report cho ca cua chinh ban.", "HTML");
    return;
  }

  const template = [
    "📝 <b>Mau tao report theo ca</b>",
    `Ca: <b>${escapeHtml(shift.policy.team.name)} / ${escapeHtml(shift.policy.name)}</b>`,
    `${formatShiftRange(shift.startsAt, shift.endsAt)}`,
    "",
    "Gui theo cu phap:",
    `<code>/report ${shift.id} | MEDIUM | Tieu de su co | Mo ta ngan | Impact | Root cause | Action items</code>`,
    "",
    "Severity hop le: LOW, MEDIUM, HIGH, CRITICAL",
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
        "📝 Dung /report theo cu phap:",
        "<code>/report &lt;shiftId&gt; | &lt;severity&gt; | &lt;title&gt; | &lt;description&gt; | &lt;impact&gt; | &lt;rootCause&gt; | &lt;actionItems&gt;</code>",
        "Vi du:",
        "<code>/report 11111111-1111-1111-1111-111111111111 | HIGH | API timeout | Anh huong login | 20% user loi | DB lock | Tang ket noi + toi uu query</code>",
      ].join("\n"),
      "HTML",
      {
        inline_keyboard: [[{ text: "Chon ca de tao report", callback_data: "rpt:list" }]],
      }
    );
    return;
  }

  const parts = payload.split("|").map((p) => p.trim());
  if (parts.length < 3) {
    await sendTelegramMessage(chatId.toString(), "❌ Thieu du lieu. Can it nhat: shiftId | severity | title", "HTML");
    return;
  }

  const shiftId = parts[0];
  if (!isUuid(shiftId)) {
    await sendTelegramMessage(chatId.toString(), "❌ shiftId khong hop le.", "HTML");
    return;
  }

  const severityRaw = (parts[1] || "MEDIUM").toUpperCase();
  if (!isSeverity(severityRaw)) {
    await sendTelegramMessage(chatId.toString(), "❌ severity phai la LOW/MEDIUM/HIGH/CRITICAL.", "HTML");
    return;
  }
  const severity = severityRaw as IncidentSeverity;

  const title = parts[2];
  if (!title || title.length < 3) {
    await sendTelegramMessage(chatId.toString(), "❌ title phai toi thieu 3 ky tu.", "HTML");
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
    await sendTelegramMessage(chatId.toString(), "❌ Khong tim thay shift.", "HTML");
    return;
  }

  if (shift.assigneeId !== user.id) {
    await sendTelegramMessage(chatId.toString(), "❌ Chi nguoi truc cua ca nay moi duoc tao report.", "HTML");
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
        note: "Tao incident tu Telegram",
      },
    });

    return createdIncident;
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const lines = [
    "✅ Tao report thanh cong.",
    `Incident ID: <code>${incident.id}</code>`,
    `Ca: <b>${escapeHtml(shift.policy.team.name)} / ${escapeHtml(shift.policy.name)}</b>`,
    `Severity: <b>${severityRaw}</b>`,
  ];
  if (appUrl) {
    lines.push(`Xem tong hop: <a href="${appUrl}/incidents">${appUrl}/incidents</a>`);
  }

  await sendTelegramMessage(chatId.toString(), lines.join("\n"), "HTML", {
    inline_keyboard: [[{ text: "📝 Tao report tiep", callback_data: "rpt:list" }]],
  });
}

function mapMenuShortcut(text: string):
  | "menu"
  | "myshifts"
  | "oncall"
  | "swaps"
  | "checklist"
  | "report"
  | "help"
  | null {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return null;

  if (normalized === "🏠 menu chinh" || normalized === "menu chinh" || normalized === "menu") {
    return "menu";
  }
  if (normalized === "📅 lich truc cua toi" || normalized === "lich truc cua toi") {
    return "myshifts";
  }
  if (normalized === "🟢 ca dang truc" || normalized === "ca dang truc") {
    return "oncall";
  }
  if (normalized === "🔁 doi ca" || normalized === "doi ca") {
    return "swaps";
  }
  if (normalized === "✅ checklist" || normalized === "checklist") {
    return "checklist";
  }
  if (normalized === "📝 bao cao" || normalized === "bao cao") {
    return "report";
  }
  if (normalized === "🆘 ho tro" || normalized === "ho tro") {
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
            policy: { select: { name: true, teamId: true } },
          },
        },
      },
    });

    if (!confirmation || confirmation.status !== ConfirmationStatus.PENDING) {
      await answerCallbackQuery(cbId, "Ca nay da duoc xu ly roi.", true);
      return true;
    }

    if (new Date() > confirmation.dueAt) {
      await prisma.shiftConfirmation.update({
        where: { id: confirmation.id },
        data: { status: ConfirmationStatus.EXPIRED },
      });
      await answerCallbackQuery(cbId, "Xac nhan da het han.", true);
      return true;
    }

    const newStatus =
      action === "confirm" ? ConfirmationStatus.CONFIRMED : ConfirmationStatus.DECLINED;
    await prisma.shiftConfirmation.update({
      where: { id: confirmation.id },
      data: { status: newStatus, respondedAt: new Date() },
    });

    const icon = action === "confirm" ? "✅" : "❌";
    const label = action === "confirm" ? "Da xac nhan" : "Da tu choi";
    const updatedText = [
      `${icon} <b>${label} ca truc</b>`,
      "",
      `Ca: <b>${escapeHtml(confirmation.shift.policy.name)}</b>`,
      `Bat dau: ${formatDateTime(confirmation.shift.startsAt)}`,
      `Ket thuc: ${formatDateTime(confirmation.shift.endsAt)}`,
      "",
      `Nguoi thuc hien: ${escapeHtml(from.first_name ?? "Telegram user")}`,
    ].join("\n");

    await editMessageText(chatId, msgId, updatedText, "HTML", { inline_keyboard: [] });
    await answerCallbackQuery(cbId, `${icon} ${label} thanh cong!`);

    const otherDeliveries = await prisma.notificationDelivery.findMany({
      where: {
        channelType: ChannelType.TELEGRAM,
        status: DeliveryStatus.SENT,
        externalId: { startsWith: `${chatId}|`, not: `${chatId}|${msgId}` },
        message: { shiftId: confirmation.shiftId },
      },
      select: { externalId: true },
    });
    if (otherDeliveries.length > 0) {
      await editTelegramDeliveries(otherDeliveries, updatedText).catch(() => {});
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

    return true;
  }

  if (data.startsWith("ack:")) {
    const alertId = data.slice(4);

    const alert = await prisma.alert.findUnique({ where: { id: alertId } });
    if (!alert || alert.status !== "FIRING") {
      await answerCallbackQuery(cbId, "Canh bao nay da duoc xu ly roi.", true);
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
      "👍 <b>Canh bao da duoc nhan</b>",
      "",
      `<b>${escapeHtml(alert.title)}</b>`,
      ...(alert.message ? [escapeHtml(alert.message), ""] : []),
      `Nhan boi: <b>${escapeHtml(ackLabel)}</b>`,
    ].join("\n");

    await editMessageText(chatId, msgId, updatedText, "HTML", { inline_keyboard: [] });
    await answerCallbackQuery(cbId, `👍 Da nhan boi ${ackLabel}`);
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

  if (!(data.startsWith("menu:") || data.startsWith("chk:") || data.startsWith("sw:") || data.startsWith("rpt:"))) {
    return false;
  }

  const user = await requireLinkedUser(chatId);
  if (!user) {
    await answerCallbackQuery(cb.id, "Chat chua lien ket tai khoan", true);
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
        await answerCallbackQuery(cb.id, "Task action khong hop le", true);
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

    await answerCallbackQuery(cb.id);
    return true;
  } catch (error) {
    console.error("[telegram] callback handler error:", error);
    await answerCallbackQuery(cb.id, "Co loi khi xu ly thao tac", true).catch(() => {});
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
          `✅ Tai khoan <b>${escapeHtml(linkedUser.fullName)}</b> da lien ket thanh cong!`,
          "HTML"
        );
        await sendMainMenu(chatId, linkedUser.fullName);
        await sendMainMenuInline(chatId);
      } else {
        const existingLinkedUser = await prisma.user.findFirst({
          where: { telegramChatId: BigInt(chatId) },
          select: { fullName: true },
        });

        if (existingLinkedUser) {
          await sendTelegramMessage(
            chatId.toString(),
            `ℹ️ Chat nay dang lien ket voi tai khoan <b>${escapeHtml(existingLinkedUser.fullName)}</b>.`,
            "HTML"
          );
          return;
        }

        await sendTelegramMessage(
          chatId.toString(),
          [
            "❌ Ma lien ket khong hop le hoac da het han (10 phut).",
            "Vui long vao ung dung -> Ho so -> Ket noi Telegram de tao ma moi.",
            "Sau do gui lai: <code>/link &lt;ma_lien_ket&gt;</code>",
          ].join("\n"),
          "HTML"
        );
      }
      return;
    }

    const linkedUser = await getLinkedUserByChatId(chatId);
    if (linkedUser) {
      await sendMainMenu(chatId, linkedUser.fullName);
      await sendMainMenuInline(chatId);
    } else {
      await sendTelegramMessage(
        chatId.toString(),
        [
          "👋 Xin chao! De lien ket Telegram:",
          "1) Vao ung dung -> Ho so -> Ket noi Telegram",
          "2) Gui: <code>/link &lt;ma_lien_ket&gt;</code>",
        ].join("\n"),
        "HTML"
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
        "ℹ️ Lenh khong duoc ho tro. Dung /menu de mo danh sach chuc nang.",
        "HTML"
      );
  }
}

export async function processTelegramUpdate(update: TelegramUpdate): Promise<void> {
  const legacyHandled = await handleLegacyCallbackActions(update);
  if (legacyHandled) return;

  const menuHandled = await handleMenuCallback(update);
  if (menuHandled) return;

  await handleTextCommand(update);
}

