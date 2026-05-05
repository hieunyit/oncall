// Job payload types for all queues

export interface ConfirmationReminderJobPayload {
  shiftId: string;
  confirmationId: string;
  recipientId: string;
  leadHours: number;
  kind?: "CONFIRMATION_REMINDER";
}

export interface ShiftEndReminderJobPayload {
  shiftId: string;
  recipientId: string;
  kind: "SHIFT_END_REMINDER";
}

export type ReminderJobPayload = ConfirmationReminderJobPayload | ShiftEndReminderJobPayload;

export interface EscalationJobPayload {
  shiftId: string;
  confirmationId: string;
  step: number;
  policyId: string;
}

export interface EmailJobPayload {
  deliveryId: string;
  messageId: string;
  to: string;
  subject: string;
  templateId: string;
  variables: Record<string, string>;
}

export interface TeamsJobPayload {
  deliveryId: string;
  messageId: string;
  webhookUrl: string;
  templateId: string;
  variables: Record<string, string>;
}

export interface TelegramJobPayload {
  deliveryId: string;
  messageId: string;
  chatId: string;
  templateId: string;
  variables: Record<string, string>;
}

export interface WebhookProcessorJobPayload {
  source: "telegram";
  rawBody: string;
  timestamp: number;
}
