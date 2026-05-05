export const TELEGRAM_BOT_COMMANDS = [
  { command: "menu", description: "Mở menu chính" },
  { command: "oncall", description: "Xem ca đang trực hiện tại" },
  { command: "myshifts", description: "Xem lịch trực của tôi" },
  { command: "export", description: "Xuất lịch trực CSV/Excel (admin/manager)" },
  { command: "checklist", description: "Cập nhật checklist ca trực" },
  { command: "swaps", description: "Tạo/nhận đổi ca" },
  { command: "report", description: "Tạo report theo ca" },
  { command: "help", description: "Hướng dẫn sử dụng bot" },
] as const;

export const TELEGRAM_MENU_TEXT = {
  MAIN: "🏠 Menu chính",
  SHIFTS: "📅 Lịch trực của tôi",
  ONCALL: "🟢 Ca đang trực",
  SWAPS: "🔁 Đổi ca",
  CHECKLIST: "✅ Checklist",
  REPORT: "📝 Báo cáo",
  EXPORT: "📤 Xuất lịch",
  HELP: "🆘 Hỗ trợ",
} as const;

export function buildMainMenuReplyKeyboard(): object {
  return {
    keyboard: [
      [{ text: TELEGRAM_MENU_TEXT.MAIN }],
      [{ text: TELEGRAM_MENU_TEXT.SHIFTS }, { text: TELEGRAM_MENU_TEXT.ONCALL }],
      [{ text: TELEGRAM_MENU_TEXT.SWAPS }, { text: TELEGRAM_MENU_TEXT.CHECKLIST }],
      [{ text: TELEGRAM_MENU_TEXT.REPORT }, { text: TELEGRAM_MENU_TEXT.EXPORT }],
      [{ text: TELEGRAM_MENU_TEXT.HELP }],
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: "Chọn tính năng...",
  };
}

export function buildMainMenuInlineKeyboard(): object {
  return {
    inline_keyboard: [
      [
        { text: TELEGRAM_MENU_TEXT.SHIFTS, callback_data: "menu:shifts" },
        { text: TELEGRAM_MENU_TEXT.ONCALL, callback_data: "menu:oncall" },
      ],
      [
        { text: TELEGRAM_MENU_TEXT.SWAPS, callback_data: "menu:swaps" },
        { text: TELEGRAM_MENU_TEXT.CHECKLIST, callback_data: "menu:checklist" },
      ],
      [
        { text: TELEGRAM_MENU_TEXT.REPORT, callback_data: "menu:report" },
        { text: TELEGRAM_MENU_TEXT.EXPORT, callback_data: "menu:export" },
      ],
      [
        { text: TELEGRAM_MENU_TEXT.HELP, callback_data: "menu:help" },
      ],
    ],
  };
}

export function buildBackToMainInlineKeyboard(): object {
  return {
    inline_keyboard: [
      [{ text: TELEGRAM_MENU_TEXT.MAIN, callback_data: "menu:main" }],
    ],
  };
}
