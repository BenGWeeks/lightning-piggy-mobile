import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Local "I claimed this Piggy" history. Used by the Hunt feature (#468) to:
 *
 * 1. Render the soft `⚡ claimed` badge on a comment posted by us, even
 *    after the comment-publish path lost the in-flight context.
 * 2. Surface a "you've already claimed this in the last N hours, the
 *    issuer's wait_time hint says wait M more" warning before re-attempting.
 *
 * Keyed by **the LNURL string itself** (not the bech32 form, not the URL
 * — whatever the user pasted/scanned, normalised to lower-case-trimmed).
 * Per-account isolation handled by AsyncStorage's per-account key prefix
 * elsewhere in the app — this module just stores raw entries; the caller
 * combines with the active npub via `perAccountKey` if needed. For v1 the
 * storage is global; per-account split lands when multi-account claim
 * histories matter.
 */

const STORAGE_KEY = 'hunt-claim-history:v1';
const MAX_ENTRIES = 500; // soft cap so the list doesn't grow forever
const NORMALISE = (s: string): string => s.trim().toLowerCase();

export interface ClaimHistoryEntry {
  /** Lower-cased trimmed LNURL string the claim was against. Same key
   * the discovery feed uses to look up "is this a Piggy I claimed?". */
  lnurl: string;
  /** Unix-seconds timestamp of the successful claim. We use seconds (not
   * millis) so timestamps line up with `created_at` on Nostr events the
   * detail screen renders alongside. */
  claimedAt: number;
  /** Sats actually received. Surfaces as "you got 21 sats from this
   * Piggy 47m ago" on the detail screen. */
  sats: number;
  /** Optional `d` tag of the kind-30408 event we matched the LNURL to.
   * Lets the UI link directly to the Piggy detail page. Absent for tags
   * that were never published as a Piggy event. */
  piggyId?: string;
}

export const loadClaimHistory = async (): Promise<ClaimHistoryEntry[]> => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidEntry);
  } catch {
    return [];
  }
};

export const recordClaim = async (
  entry: Omit<ClaimHistoryEntry, 'claimedAt'> & { claimedAt?: number },
): Promise<ClaimHistoryEntry[]> => {
  const next: ClaimHistoryEntry = {
    lnurl: NORMALISE(entry.lnurl),
    claimedAt: entry.claimedAt ?? Math.floor(Date.now() / 1000),
    sats: entry.sats,
    piggyId: entry.piggyId,
  };
  const list = await loadClaimHistory();
  // Prepend, then cap to MAX_ENTRIES so old claims rotate out FIFO. We
  // don't dedupe by lnurl — multiple claims of the same Piggy across
  // its cooldown window are legitimate history points.
  const merged = [next, ...list].slice(0, MAX_ENTRIES);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  return merged;
};

/** Returns the most-recent claim against this LNURL, or null. */
export const lastClaimFor = async (lnurl: string): Promise<ClaimHistoryEntry | null> => {
  const target = NORMALISE(lnurl);
  const list = await loadClaimHistory();
  return list.find((e) => e.lnurl === target) ?? null;
};

const isValidEntry = (v: unknown): v is ClaimHistoryEntry => {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  if (typeof e.lnurl !== 'string') return false;
  if (typeof e.claimedAt !== 'number') return false;
  if (typeof e.sats !== 'number') return false;
  if (e.piggyId !== undefined && typeof e.piggyId !== 'string') return false;
  return true;
};
