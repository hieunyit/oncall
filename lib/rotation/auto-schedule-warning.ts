const AUTO_SCHEDULE_WARNING_TAG = "[AUTO_WARN_INSUFFICIENT_PEOPLE]";

export const AUTO_SCHEDULE_WARNING_MESSAGE =
  "Không đủ người để chia ca theo ràng buộc 1 người 1 ca trong ngày. Hệ thống đã tạo lịch và gắn cảnh báo.";

export function buildAutoScheduleWarningNote(baseNote?: string | null): string {
  const trimmed = baseNote?.trim();
  if (!trimmed) {
    return `${AUTO_SCHEDULE_WARNING_TAG}\n${AUTO_SCHEDULE_WARNING_MESSAGE}`;
  }
  if (trimmed.includes(AUTO_SCHEDULE_WARNING_TAG)) {
    return trimmed;
  }
  return `${trimmed}\n${AUTO_SCHEDULE_WARNING_TAG}\n${AUTO_SCHEDULE_WARNING_MESSAGE}`;
}

export function hasAutoScheduleWarning(notes?: string | null): boolean {
  return Boolean(notes && notes.includes(AUTO_SCHEDULE_WARNING_TAG));
}

export function getAutoScheduleWarningMessage(notes?: string | null): string | null {
  if (!notes || !hasAutoScheduleWarning(notes)) return null;
  const lines = notes
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const messageLine = lines.find((line) => line !== AUTO_SCHEDULE_WARNING_TAG);
  return messageLine ?? AUTO_SCHEDULE_WARNING_MESSAGE;
}
