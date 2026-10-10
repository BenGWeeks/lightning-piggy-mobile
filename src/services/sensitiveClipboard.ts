// Copy a secret with the platform's protections (#1223), via the local
// SecureClipboard module: Android marks the clip sensitive (masked preview,
// kept out of Gboard's history); iOS writes it local-only (no Universal
// Clipboard) with an OS-enforced expiry.
//
// Android has no clipboard expiry, so we also clear it after a short window
// unless another value replaced it — best effort only: it can't reach a
// keyboard's own history, and OS suspension can delay it. Keep only the
// fingerprint, never the secret, for that. Android disallows background
// clipboard reads, so retry an expired clear after returning to the
// foreground. iOS skips the JS clear: the native expiry covers it, and a
// read after another app copied something would raise the paste prompt.
import { AppState, Platform, type NativeEventSubscription } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { isSecureClipboardAvailable, setSecretStringAsync } from '../../modules/secure-clipboard';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

export const SENSITIVE_CLIPBOARD_CLEAR_MS = 60_000;

type PendingClear = {
  timer: ReturnType<typeof setTimeout>;
  fingerprint: string;
  expiresAt: number;
  subscription: NativeEventSubscription;
};
let pending: PendingClear | null = null;

function fingerprint(text: string): string {
  return bytesToHex(sha256(utf8ToBytes(text)));
}

function cancelPending(): void {
  if (!pending) return;
  clearTimeout(pending.timer);
  pending.subscription.remove();
  pending = null;
}

/**
 * Whether secrets can be copied safely on this build. False on a dev client
 * built before the native module existed — hide Copy rather than fall back
 * to a plain clipboard write.
 */
export function canCopySensitiveText(): boolean {
  return isSecureClipboardAvailable();
}

export async function copySensitiveText(
  text: string,
  clearAfterMs: number = SENSITIVE_CLIPBOARD_CLEAR_MS,
): Promise<void> {
  await setSecretStringAsync(text, clearAfterMs);
  cancelPending();
  if (Platform.OS === 'ios') return;
  const entry: PendingClear = {
    fingerprint: fingerprint(text),
    expiresAt: Date.now() + clearAfterMs,
    timer: setTimeout(() => void clearIfUnchanged(entry), clearAfterMs),
    subscription: AppState.addEventListener('change', (state) => {
      if (state !== 'active' || pending !== entry) return;
      clearTimeout(entry.timer);
      // Stagger resume work; also preserve the full copy window if not expired.
      entry.timer = setTimeout(
        () => void clearIfUnchanged(entry),
        Math.max(3000, entry.expiresAt - Date.now()),
      );
    }),
  };
  pending = entry;
}

async function clearIfUnchanged(entry: PendingClear): Promise<void> {
  if (pending !== entry || AppState.currentState !== 'active') return;
  try {
    const current = await Clipboard.getStringAsync();
    if (pending !== entry || AppState.currentState !== 'active') return;
    if (current && fingerprint(current) === entry.fingerprint) await Clipboard.setStringAsync('');
    if (pending === entry) cancelPending();
  } catch {
    // Best effort: leave the fingerprint pending for the next foreground retry.
    // iOS may require paste permission if another app replaced the content.
  }
}

/** Test hook: drop any scheduled clear and foreground listener. */
export function __resetSensitiveClipboardForTests(): void {
  cancelPending();
}
