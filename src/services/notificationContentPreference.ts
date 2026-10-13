import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Privacy preference: should the real (decrypted) title/body be included in
 * notifications at all? Default OFF. When OFF, `fireNotification` substitutes
 * generic copy ("New message" / "Payment received") at SCHEDULE time, so the
 * plaintext never enters the OS notification store — it's hidden everywhere
 * (lock screen, shade, history), not just on the lock screen. This is the
 * cross-platform enforcement; the Android channels are `PRIVATE` (not
 * `SECRET`) so that, once the user opts in, the entry still shows and honours
 * their system "hide sensitive content" setting.
 *
 * Surfaced as the "notification content" toggle in
 * `src/screens/account/NotificationSettingsScreen.tsx`.
 */
const LOCK_SCREEN_CONTENT_KEY = 'notif_pref_lockscreen_content_v1';
let cachedLockScreenContent: boolean | null = null;

export async function getLockScreenContentEnabled(): Promise<boolean> {
  if (cachedLockScreenContent !== null) return cachedLockScreenContent;
  const raw = await AsyncStorage.getItem(LOCK_SCREEN_CONTENT_KEY).catch(() => null);
  cachedLockScreenContent = raw === 'true';
  return cachedLockScreenContent;
}

export async function setLockScreenContentEnabled(
  enabled: boolean,
  reportFailure = false,
): Promise<void> {
  const previous = cachedLockScreenContent;
  cachedLockScreenContent = enabled;
  try {
    await AsyncStorage.setItem(LOCK_SCREEN_CONTENT_KEY, enabled ? 'true' : 'false');
  } catch (error) {
    if (reportFailure) {
      cachedLockScreenContent = previous;
      throw error;
    }
  }
}

export const resetLockScreenContentPreference = (): void => {
  cachedLockScreenContent = null;
};
