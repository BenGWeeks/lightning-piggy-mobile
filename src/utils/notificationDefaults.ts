/** Stored values (including legacy OFF) are choices, never a missing default. */
export interface NotificationPreferences {
  instant: boolean | null;
  more: boolean | null;
}

export function resolveNotificationDefaults({
  preferences,
  otherAccountHasPreference,
  permissionDenied = false,
}: {
  preferences: NotificationPreferences;
  otherAccountHasPreference: boolean;
  permissionDenied?: boolean;
}): { instant: boolean; more: boolean } {
  if (permissionDenied) return { instant: false, more: false };
  const firstAccount = !otherAccountHasPreference;
  return {
    instant: preferences.instant ?? firstAccount,
    more: preferences.more ?? firstAccount,
  };
}
