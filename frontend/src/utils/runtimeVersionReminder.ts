export const RUNTIME_VERSION_REMINDER_SNOOZE_MS = 2 * 60 * 60 * 1000;
export const RUNTIME_VERSION_REMINDER_SNOOZED_UNTIL_KEY = 'comfyforge.runtimeVersionReminderSnoozedUntil';

type ReminderStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const getRuntimeVersionReminderSnoozedUntil = (storage: ReminderStorage) => {
  try {
    const value = Number(storage.getItem(RUNTIME_VERSION_REMINDER_SNOOZED_UNTIL_KEY));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
};

export const isRuntimeVersionReminderSnoozed = (
  storage: ReminderStorage,
  now = Date.now(),
) => getRuntimeVersionReminderSnoozedUntil(storage) > now;

export const snoozeRuntimeVersionReminder = (
  storage: ReminderStorage,
  now = Date.now(),
) => {
  const snoozedUntil = now + RUNTIME_VERSION_REMINDER_SNOOZE_MS;
  try {
    storage.setItem(RUNTIME_VERSION_REMINDER_SNOOZED_UNTIL_KEY, String(snoozedUntil));
  } catch {
    // Keep the in-memory snooze active when persistent storage is unavailable.
  }
  return snoozedUntil;
};
