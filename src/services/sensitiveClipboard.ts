// Copy a secret (e.g. an nsec) to the clipboard and clear it again after
// a short window, unless the user has since copied something else.
//
// Only a SHA-256 fingerprint of the secret is kept for the comparison —
// never the secret itself — and the timer lives at module scope so it
// still fires after the screen that copied it has unmounted.
//
// Platform caveats (best effort, never throws):
//  - The timer is a JS timer: if the app is backgrounded it fires when the
//    app next runs, so the clear may happen later than the window.
//  - Android 10+ blocks clipboard reads from the background; the read
//    returns empty and we skip the clear rather than clobber the clipboard.
//  - iOS 16+ may show its "Allow Paste" prompt if the clipboard now holds
//    content from ANOTHER app; reading our own content is prompt-free.
import * as Clipboard from 'expo-clipboard';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

export const SENSITIVE_CLIPBOARD_CLEAR_MS = 60_000;

let pending: { timer: ReturnType<typeof setTimeout>; fingerprint: string } | null = null;

function fingerprint(text: string): string {
  return bytesToHex(sha256(utf8ToBytes(text)));
}

export async function copySensitiveText(
  text: string,
  clearAfterMs: number = SENSITIVE_CLIPBOARD_CLEAR_MS,
): Promise<void> {
  await Clipboard.setStringAsync(text);
  if (pending) clearTimeout(pending.timer);
  const fp = fingerprint(text);
  const timer = setTimeout(() => {
    void clearIfUnchanged(fp);
  }, clearAfterMs);
  pending = { timer, fingerprint: fp };
}

async function clearIfUnchanged(fp: string): Promise<void> {
  if (pending?.fingerprint === fp) pending = null;
  try {
    const current = await Clipboard.getStringAsync();
    if (current && fingerprint(current) === fp) await Clipboard.setStringAsync('');
  } catch {
    // Best effort — see the platform caveats above.
  }
}

/** Test hook: drop any scheduled clear. */
export function __resetSensitiveClipboardForTests(): void {
  if (pending) clearTimeout(pending.timer);
  pending = null;
}
