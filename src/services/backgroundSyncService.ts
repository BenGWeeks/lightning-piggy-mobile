/**
 * backgroundSyncService — the context-free worker the native background
 * host (Android WorkManager / iOS BGTaskScheduler, via expo-background-task)
 * runs to surface OS notifications while the app's UI isn't mounted (#279).
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
 * Freshness is tracked by EVENT ID, not by a `created_at` cursor. NIP-59
 * randomises a gift wrap's `created_at` up to two days into the PAST to
 * thwart timing analysis, so a genuinely-new kind-1059 wrap can arrive
 * carrying an already-old timestamp. A `since`/`created_at` gate would let
 * the relay filter such a wrap out and silently miss real NIP-17 traffic
 * (Copilot review #282). So we query a window wide enough to span the
 * maximum backdate and dedupe against a persisted set of seen ids.
 *
 * Runs in a SEPARATE JS context from the React tree, so it reads everything
 * it needs from storage and talks to relays directly via the shared
 * nostr-tools pool. It must be cheap and self-terminating: open a query,
 * decide whether to ping, persist the seen-set, return.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { pool } from './nostrService';
import { loadIdentities } from './identitiesStore';
import { getUserRelays } from './nostrRelayStorage';
import { fireMessageNotification } from './notificationService';

// Persisted ids we've already accounted for, so repeated wakes never
// re-ping the same arrival. Bounded (insertion-ordered; oldest dropped
// past the cap). Its PRESENCE also marks that the baseline has been
// primed — see the first-run handling in runBackgroundSync.
const BG_SEEN_IDS_KEY = 'bg_sync_seen_ids_v1';
const SEEN_CAP = 1000;

// NIP-59 tweaks a wrap's `created_at` up to 2 days into the past. Query a
// window that spans that, plus a little overlap for relay clock skew, so no
// genuinely-new wrap is filtered out by the relay before we can see its id.
const NIP59_MAX_BACKDATE_SEC = 2 * 24 * 60 * 60;
const OVERLAP_SEC = 120;
const LOOKBACK_SEC = NIP59_MAX_BACKDATE_SEC + OVERLAP_SEC;

export interface BackgroundSyncResult {
  /** Whether a notification was fired this run. */
  pinged: boolean;
  /** Count of fresh inbound events detected (0 when nothing new). */
  freshCount: number;
}

/**
 * Load the persisted seen-set. `primed` is false only on the very first run
 * (key absent) so the caller can establish a silent baseline rather than
 * pinging for pre-existing history. A present-but-corrupt value is treated
 * as primed (empty set) so a bad write can't trigger a cold-start flood.
 */
async function loadSeenIds(): Promise<{ seen: Set<string>; primed: boolean }> {
  const raw = await AsyncStorage.getItem(BG_SEEN_IDS_KEY).catch(() => null);
  if (raw == null) return { seen: new Set(), primed: false };
  try {
    const arr: unknown = JSON.parse(raw);
    if (Array.isArray(arr)) {
      return { seen: new Set(arr.filter((x): x is string => typeof x === 'string')), primed: true };
    }
  } catch {
    // fall through to the primed-but-empty fallback
  }
  return { seen: new Set(), primed: true };
}

/** Persist the seen-set, keeping only the most-recent SEEN_CAP ids. */
async function persistSeenIds(seen: Set<string>): Promise<void> {
  const arr = Array.from(seen); // insertion order → tail is newest
  const bounded = arr.length > SEEN_CAP ? arr.slice(arr.length - SEEN_CAP) : arr;
  await AsyncStorage.setItem(BG_SEEN_IDS_KEY, JSON.stringify(bounded)).catch(() => {});
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

  const { seen, primed } = await loadSeenIds();
  const since = Math.floor(Date.now() / 1000) - LOOKBACK_SEC;

  try {
    // kind-1059 = NIP-17 gift wraps, kind-4 = legacy NIP-04 DMs, both
    // addressed to us via a `#p` tag.
    const events = await pool.querySync(readRelays, {
      kinds: [1059, 4],
      '#p': [activePubkey],
      since,
    });

    // Genuinely-new = an id we haven't accounted for, excluding our own
    // kind-4 echoes (real author === us). kind-1059 wrap authors are
    // ephemeral throwaway keys, so we can't distinguish a received wrap from
    // our own sent-copy without decrypting — we accept the rare false ping
    // (the app reconciles exactly on open).
    const fresh = events.filter(
      (e) => !seen.has(e.id) && !(e.kind === 4 && e.pubkey === activePubkey),
    );

    // Record everything we saw so the next wake won't reconsider it.
    for (const e of events) seen.add(e.id);
    await persistSeenIds(seen);

    // First-ever run: we've just established the baseline above. Everything
    // currently on the relays is history the user may already have read
    // in-app, so pinging for it would be a cold-start flood. Stay silent;
    // only arrivals AFTER this baseline ping on later wakes.
    if (!primed) return { pinged: false, freshCount: 0 };

    const freshCount = fresh.length;
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
    return { pinged: freshCount > 0, freshCount };
  } catch {
    // Best-effort: a failed relay round-trip just means we retry next wake.
    return { pinged: false, freshCount: 0 };
  }
}
