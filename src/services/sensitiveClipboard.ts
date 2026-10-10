// Copy a secret and clear it after a short window unless another value
// replaced it. Keep only its fingerprint, never the secret, for expiry.
// Android disallows background clipboard reads, so retry an expired clear
// after returning to the foreground. OS suspension can delay expiry.
import { AppState, type NativeEventSubscription } from 'react-native';
import * as Clipboard from 'expo-clipboard';
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

export async function copySensitiveText(
  text: string,
  clearAfterMs: number = SENSITIVE_CLIPBOARD_CLEAR_MS,
): Promise<void> {
  await Clipboard.setStringAsync(text);
  cancelPending();
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
