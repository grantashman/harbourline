export const genericReminderNotification = {
  title: "Harbourline reminder",
  body: "Take a moment to review your plan."
} as const;

export function isGenericReminderNotification(value: { title?: unknown; body?: unknown }): boolean {
  return value.title === genericReminderNotification.title && value.body === genericReminderNotification.body;
}
