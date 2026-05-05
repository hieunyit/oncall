import { prisma } from "@/lib/prisma";

export interface PolicyTelegramOptions {
  requirePhotoOnConfirm: boolean;
  endShiftReminderEnabled: boolean;
  requirePhotoOnCheckout: boolean;
  managerImportErrorEnabled: boolean;
}

type PolicyTelegramOptionsRow = {
  id: string;
  telegram_require_photo_on_confirm: boolean | null;
  telegram_end_shift_reminder_enabled: boolean | null;
  telegram_require_photo_on_checkout: boolean | null;
  telegram_manager_import_error_enabled: boolean | null;
};

export const DEFAULT_POLICY_TELEGRAM_OPTIONS: PolicyTelegramOptions = {
  requirePhotoOnConfirm: false,
  endShiftReminderEnabled: false,
  requirePhotoOnCheckout: false,
  managerImportErrorEnabled: false,
};

function parseRow(row?: Partial<PolicyTelegramOptionsRow> | null): PolicyTelegramOptions {
  return {
    requirePhotoOnConfirm:
      typeof row?.telegram_require_photo_on_confirm === "boolean"
        ? row.telegram_require_photo_on_confirm
        : DEFAULT_POLICY_TELEGRAM_OPTIONS.requirePhotoOnConfirm,
    endShiftReminderEnabled:
      typeof row?.telegram_end_shift_reminder_enabled === "boolean"
        ? row.telegram_end_shift_reminder_enabled
        : DEFAULT_POLICY_TELEGRAM_OPTIONS.endShiftReminderEnabled,
    requirePhotoOnCheckout:
      typeof row?.telegram_require_photo_on_checkout === "boolean"
        ? row.telegram_require_photo_on_checkout
        : DEFAULT_POLICY_TELEGRAM_OPTIONS.requirePhotoOnCheckout,
    managerImportErrorEnabled:
      typeof row?.telegram_manager_import_error_enabled === "boolean"
        ? row.telegram_manager_import_error_enabled
        : DEFAULT_POLICY_TELEGRAM_OPTIONS.managerImportErrorEnabled,
  };
}

export async function getPolicyTelegramOptions(policyId: string): Promise<PolicyTelegramOptions> {
  try {
    const rows = await prisma.$queryRaw<Array<PolicyTelegramOptionsRow>>`
      SELECT
        id::text,
        telegram_require_photo_on_confirm,
        telegram_end_shift_reminder_enabled,
        telegram_require_photo_on_checkout,
        telegram_manager_import_error_enabled
      FROM rotation_policies
      WHERE id = ${policyId}::uuid
    `;
    return parseRow(rows[0]);
  } catch {
    return { ...DEFAULT_POLICY_TELEGRAM_OPTIONS };
  }
}

export async function getPolicyTelegramOptionsByIds(
  policyIds: string[]
): Promise<Record<string, PolicyTelegramOptions>> {
  if (policyIds.length === 0) return {};

  const uniqueIds = [...new Set(policyIds)];
  const fallback = Object.fromEntries(
    uniqueIds.map((id) => [id, { ...DEFAULT_POLICY_TELEGRAM_OPTIONS }])
  ) as Record<string, PolicyTelegramOptions>;

  try {
    const rows = await prisma.$queryRaw<Array<PolicyTelegramOptionsRow>>`
      SELECT
        id::text,
        telegram_require_photo_on_confirm,
        telegram_end_shift_reminder_enabled,
        telegram_require_photo_on_checkout,
        telegram_manager_import_error_enabled
      FROM rotation_policies
      WHERE id = ANY(${uniqueIds}::uuid[])
    `;

    for (const row of rows) {
      fallback[row.id] = parseRow(row);
    }
    return fallback;
  } catch {
    return fallback;
  }
}

export async function updatePolicyTelegramOptions(
  policyId: string,
  input: Partial<PolicyTelegramOptions>
): Promise<void> {
  if (
    input.requirePhotoOnConfirm === undefined &&
    input.endShiftReminderEnabled === undefined &&
    input.requirePhotoOnCheckout === undefined &&
    input.managerImportErrorEnabled === undefined
  ) {
    return;
  }

  try {
    await prisma.$executeRaw`
      UPDATE rotation_policies
      SET
        telegram_require_photo_on_confirm =
          COALESCE(${input.requirePhotoOnConfirm ?? null}::boolean, telegram_require_photo_on_confirm),
        telegram_end_shift_reminder_enabled =
          COALESCE(${input.endShiftReminderEnabled ?? null}::boolean, telegram_end_shift_reminder_enabled),
        telegram_require_photo_on_checkout =
          COALESCE(${input.requirePhotoOnCheckout ?? null}::boolean, telegram_require_photo_on_checkout),
        telegram_manager_import_error_enabled =
          COALESCE(${input.managerImportErrorEnabled ?? null}::boolean, telegram_manager_import_error_enabled)
      WHERE id = ${policyId}::uuid
    `;
  } catch {
    // Ignore on environments where migration has not been applied yet.
  }
}
