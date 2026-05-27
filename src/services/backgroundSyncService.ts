/**
 * backgroundSyncService — the context-free worker the native background
 * host (Android foreground service / iOS BGTask) runs to surface OS
 * notifications while the app's UI isn't mounted (#279).
 *
 * DETECT-AND-PING design: this NEVER decrypts. It only detects that new
 * encrypted traffic arrived and fires a GENERIC "you have new messages"
 * notification; the app decrypts and shows the real content when the user
 * opens it. That choice is deliberate:
 *   - It works for BOTH nsec and Amber users — Amber can't decrypt in the
 *     background (it needs its foreground app to approve), so a
 *     decrypt-in-background design would silently exclude Amber users.
 *   - No plaintext is ever produced off-screen — matches the privacy-first
 *     lock-screen default.
 *   - Far less code runs headless (no signer, no gift-wrap unwrap).
 *
 * Runs in a SEPARATE JS context from the React tree, so it reads
 * everything it needs from storage and talks to relays directly via the
 * shared nostr-tools pool. It must be cheap and self-terminating: open a
 * query, decide whether to ping, persist a cursor, return.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { pool } from './nostrService';
import { loadIdentities } from './identitiesStore';
import { getUserRelays } from './nostrRelayStorage';
import { fireMessageNotification } from './notificationService';

// Last wall-clock second we checked. New events are those with
// `created_at` strictly after this. Persisted so repeated wakes don't
// re-ping the same arrivals.
const BG_CURSOR_KEY = 'bg_sync_last_check_v1';

// Re-query a little before the cursor to absorb relay clock skew /
// late-delivered events without missing any.
const OVERLAP_SEC = 120;
// First-ever run (no cursor): only look back an hour so a cold start
// doesn't ping for ancient history.
const COLD_WINDOW_SEC = 60 * 60;

export interface BackgroundSyncResult {
  /** Whether a notification was fired this run. */
  pinged: boolean;
  /** Count of fresh inbound events detected (0 when nothing new). */
  freshCount: number;
}

/**
 * One background sync pass. Safe to call repeatedly; swallows its own
 * errors so a flaky relay never crashes the native host.
 */
export async function runBackgroundSync(): Promise<BackgroundSyncResult> {
  const { activePubkey } = await loadIdentities();
  if (!activePubkey) return { pinged: false, freshCount: 0 };

  const readRelays = (await getUserRelays()).filter((r) => r.read).map((r) => r.url);
  if (readRelays.length === 0) return { pinged: false, freshCount: 0 };

  const cursorRaw = await AsyncStorage.getItem(BG_CURSOR_KEY);
  // Guard against a corrupted / non-numeric stored cursor: a NaN cursor
  // would make `e.created_at > cursor` always false (never ping) and feed
  // NaN into the `since` filter. Fall back to a cold start.
  const parsedCursor = cursorRaw ? Number(cursorRaw) : 0;
  const cursor = Number.isFinite(parsedCursor) ? parsedCursor : 0;
  const now = Math.floor(Date.now() / 1000);
  const since = cursor > 0 ? Math.max(0, cursor - OVERLAP_SEC) : now - COLD_WINDOW_SEC;

  let freshCount = 0;
  try {
    // kind-1059 = NIP-17 gift wraps, kind-4 = legacy NIP-04 DMs, both
    // addressed to us via a `#p` tag.
    const events = await pool.querySync(readRelays, {
      kinds: [1059, 4],
      '#p': [activePubkey],
      since,
    });
    // Count genuinely-new inbound events. For kind-4 we can drop our own
    // echoes (real author === us). For kind-1059 the wrap author is an
    // ephemeral throwaway key, so we can't distinguish a received wrap
    // from our own sent-copy without decrypting — we accept the rare
    // false ping (the app reconciles exactly on open).
    freshCount = events.filter(
      (e) => e.created_at > cursor && !(e.kind === 4 && e.pubkey === activePubkey),
    ).length;

    if (freshCount > 0) {
      await fireMessageNotification({
        kind: 'dm',
        // Sentinel thread id — never matches an actively-viewed thread, so
        // the suppression gate always lets a background ping through.
        threadId: '__background__',
        title: freshCount > 1 ? 'New messages' : 'New message',
        body: 'Open Lightning Piggy to read',
        // No conversation id (we didn't decrypt) → tap opens the Messages
        // list rather than a specific thread.
        data: {},
      });
    }
    // Advance the cursor ONLY after a successful query — if the relay
    // round-trip threw, the events in this window were never fetched, so
    // advancing would skip them permanently (they'd only resurface on the
    // next app open). Leaving the cursor put means the next wake re-queries
    // the same `since` and catches up.
    await AsyncStorage.setItem(BG_CURSOR_KEY, String(now));
  } catch {
    // Best-effort: a failed relay round-trip just means we retry next wake
    // from the same cursor.
  }

  return { pinged: freshCount > 0, freshCount };
}
