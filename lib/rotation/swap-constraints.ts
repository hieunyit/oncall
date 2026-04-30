import { ShiftStatus } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";

const DEFAULT_TZ = "Asia/Ho_Chi_Minh";
const ADJACENT_SHIFT_GAP_MS = 60 * 1000; // 1 minute tolerance
const CONSECUTIVE_NIGHT_WINDOW_MS = 36 * 60 * 60 * 1000; // ~day-to-day night slot

function getLocalParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const year = Number(parts.find((p) => p.type === "year")?.value ?? "0");
  const month = Number(parts.find((p) => p.type === "month")?.value ?? "0");
  const day = Number(parts.find((p) => p.type === "day")?.value ?? "0");
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  return {
    dayKey: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    hour,
  };
}

export function isNightShift(
  shift: { startsAt: Date; endsAt: Date },
  timeZone?: string | null
): boolean {
  const tz = timeZone ?? DEFAULT_TZ;
  const start = getLocalParts(shift.startsAt, tz);
  const end = getLocalParts(shift.endsAt, tz);
  const crossesDay = start.dayKey !== end.dayKey;
  return crossesDay || start.hour >= 18 || start.hour < 6;
}

export async function validateSwapAssignmentConstraints(input: {
  userId: string;
  teamId: string;
  startsAt: Date;
  endsAt: Date;
  timezone?: string | null;
  excludeShiftIds?: string[];
  allowConsecutive?: boolean;
  allowConsecutiveNight?: boolean;
}): Promise<{ code: string; message: string } | null> {
  const excludeShiftIds = (input.excludeShiftIds ?? []).filter(Boolean);
  const activeStatuses = [ShiftStatus.PUBLISHED, ShiftStatus.ACTIVE];

  const baseWhere = {
    assigneeId: input.userId,
    policy: { teamId: input.teamId },
    status: { in: activeStatuses },
    ...(excludeShiftIds.length > 0 ? { id: { notIn: excludeShiftIds } } : {}),
  } as const;

  const overlap = await prisma.shift.findFirst({
    where: {
      ...baseWhere,
      startsAt: { lt: input.endsAt },
      endsAt: { gt: input.startsAt },
    },
    select: { id: true },
  });
  if (overlap) {
    return {
      code: "SHIFT_OVERLAP",
      message: "Người nhận ca đã có ca trùng thời gian.",
    };
  }

  const [previousShift, nextShift] = await Promise.all([
    prisma.shift.findFirst({
      where: {
        ...baseWhere,
        endsAt: { lte: input.startsAt },
      },
      include: {
        policy: { select: { timezone: true } },
      },
      orderBy: { endsAt: "desc" },
    }),
    prisma.shift.findFirst({
      where: {
        ...baseWhere,
        startsAt: { gte: input.endsAt },
      },
      include: {
        policy: { select: { timezone: true } },
      },
      orderBy: { startsAt: "asc" },
    }),
  ]);

  const prevGap = previousShift
    ? input.startsAt.getTime() - previousShift.endsAt.getTime()
    : Number.POSITIVE_INFINITY;
  const nextGap = nextShift
    ? nextShift.startsAt.getTime() - input.endsAt.getTime()
    : Number.POSITIVE_INFINITY;

  if (
    !input.allowConsecutive &&
    (prevGap <= ADJACENT_SHIFT_GAP_MS || nextGap <= ADJACENT_SHIFT_GAP_MS)
  ) {
    return {
      code: "CONSECUTIVE_SHIFT",
      message: "Không thể đổi ca: sẽ tạo 2 ca liên tiếp cho cùng một người.",
    };
  }

  const proposedIsNight = isNightShift(
    { startsAt: input.startsAt, endsAt: input.endsAt },
    input.timezone
  );
  if (!proposedIsNight) return null;

  if (
    !input.allowConsecutiveNight &&
    previousShift &&
    isNightShift(previousShift, previousShift.policy.timezone) &&
    input.startsAt.getTime() - previousShift.startsAt.getTime() <=
      CONSECUTIVE_NIGHT_WINDOW_MS
  ) {
    return {
      code: "CONSECUTIVE_NIGHT_SHIFT",
      message: "Không thể đổi ca: sẽ tạo 2 ca đêm liên tiếp cho cùng một người.",
    };
  }

  if (
    !input.allowConsecutiveNight &&
    nextShift &&
    isNightShift(nextShift, nextShift.policy.timezone) &&
    nextShift.startsAt.getTime() - input.startsAt.getTime() <=
      CONSECUTIVE_NIGHT_WINDOW_MS
  ) {
    return {
      code: "CONSECUTIVE_NIGHT_SHIFT",
      message: "Không thể đổi ca: sẽ tạo 2 ca đêm liên tiếp cho cùng một người.",
    };
  }

  return null;
}
