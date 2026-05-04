export const TELEGRAM_BOT_COMMANDS = [
  { command: "menu", description: "Mo menu chinh" },
  { command: "oncall", description: "Xem ca dang truc hien tai" },
  { command: "myshifts", description: "Xem lich truc cua toi" },
  { command: "checklist", description: "Cap nhat checklist ca truc" },
  { command: "swaps", description: "Tao/nhan doi ca" },
  { command: "report", description: "Tao report theo ca" },
  { command: "help", description: "Huong dan su dung bot" },
] as const;

export const TELEGRAM_MENU_TEXT = {
  MAIN: "🏠 Menu chinh",
  SHIFTS: "📅 Lich truc cua toi",
  ONCALL: "🟢 Ca dang truc",
  SWAPS: "🔁 Doi ca",
  CHECKLIST: "✅ Checklist",
  REPORT: "📝 Bao cao",
  HELP: "🆘 Ho tro",
} as const;

export function buildMainMenuReplyKeyboard(): object {
  return {
    keyboard: [
      [{ text: TELEGRAM_MENU_TEXT.MAIN }],
      [{ text: TELEGRAM_MENU_TEXT.SHIFTS }, { text: TELEGRAM_MENU_TEXT.ONCALL }],
      [{ text: TELEGRAM_MENU_TEXT.SWAPS }, { text: TELEGRAM_MENU_TEXT.CHECKLIST }],
      [{ text: TELEGRAM_MENU_TEXT.REPORT }, { text: TELEGRAM_MENU_TEXT.HELP }],
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: "Chon tinh nang...",
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

