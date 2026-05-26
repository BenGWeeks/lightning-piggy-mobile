import AsyncStorage from '@react-native-async-storage/async-storage';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/**
 * Local "I claimed this Piggy" history. Used by the Hunt feature (#468) to:
 *
 * 1. Render the soft `⚡ claimed` badge on a comment posted by us, even
 *    after the comment-publish path lost the in-flight context.
 * 2. Surface a "you've already claimed this in the last N hours, the
 *    issuer's wait_time hint says wait M more" warning before re-attempting.
 *
 * Keyed by **SHA-256 of the normalised LNURL** — never the bearer string
 * itself. AsyncStorage is unencrypted and easier to extract than
 * SecureStore, so persisting the live withdraw URL would let a stolen /
 * rooted device replay un-exhausted Piggies (Copilot review #488). We
 * only need the LNURL as a lookup key for "have I claimed this?", so a
 * one-way hash is sufficient.
 *
 * Storage key bumped to `:v2` on the AsyncStorage swap — the v1 entries
 * still carry raw LNURLs and are abandoned silently (the feature is
 * pre-release on `feat/explore-tab`; nothing in production yet).
 *
 * Per-account isolation handled by AsyncStorage's per-account key prefix
 * elsewhere in the app. For v1 the storage is global; per-account split
 * lands when multi-account claim histories matter.
 */

const STORAGE_KEY = 'hunt-claim-history:v2';
const MAX_ENTRIES = 500; // soft cap so the list doesn't grow forever
const NORMALISE = (s: string): string => s.trim().toLowerCase();
const hashLnurl = (lnurl: string): string =>
  bytesToHex(sha256(new TextEncoder().encode(NORMALISE(lnurl))));

export interface ClaimHistoryEntry {
  /** SHA-256 hex digest of the lower-cased trimmed LNURL the claim was
   * against. We never persist the bearer token itself — AsyncStorage
   * isn't encrypted. The hash is enough to answer "have I claimed
   * this?" via `lastClaimFor(lnurl)` which hashes its input. */
  lnurlHash: string;
  /** Unix-seconds timestamp of the successful claim. We use seconds (not
   * millis) so timestamps line up with `created_at` on Nostr events the
   * detail screen renders alongside. */
  claimedAt: number;
  /** Sats actually received. Surfaces as "you got 21 sats from this
   * Piggy 47m ago" on the detail screen. */
  sats: number;
  /** Optional `d` tag of the NIP-GC kind 37516 cache listing we matched
   * the LNURL to. Lets the UI link directly to the Piggy detail page.
   * Absent for tag taps that were never published as a kind 37516 event
   * (e.g. a friend handed you a one-shot QR that lives nowhere on
   * Nostr). */
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

export const recordClaim = async (entry: {
  lnurl: string;
  sats: number;
  piggyId?: string;
  claimedAt?: number;
}): Promise<ClaimHistoryEntry[]> => {
  const next: ClaimHistoryEntry = {
    lnurlHash: hashLnurl(entry.lnurl),
    claimedAt: entry.claimedAt ?? Math.floor(Date.now() / 1000),
    sats: entry.sats,
    piggyId: entry.piggyId,
  };
  const list = await loadClaimHistory();
  // Prepend, then cap to MAX_ENTRIES so old claims rotate out FIFO. We
  // don't dedupe by hash — multiple claims of the same Piggy across
  // its cooldown window are legitimate history points.
  const merged = [next, ...list].slice(0, MAX_ENTRIES);
  // Best-effort persist — a transient AsyncStorage failure (quota / IO)
  // shouldn't crash the claim flow. The in-memory `merged` list is
  // still returned so the UI can keep showing the soft claim badge for
  // the current session even if the write didn't land (Copilot review
  // #488).
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // intentional: history is a soft UI hint, not load-bearing state
  }
  return merged;
};

/** Returns the most-recent claim against this LNURL, or null. */
export const lastClaimFor = async (lnurl: string): Promise<ClaimHistoryEntry | null> => {
  const target = hashLnurl(lnurl);
  const list = await loadClaimHistory();
  return list.find((e) => e.lnurlHash === target) ?? null;
};

/**
 * Returns the most-recent claim against this NIP-GC cache coord, or null.
 * Used by HuntPiggyDetailScreen to unlock the find-log composer after a
 * successful claim — keyed by `piggyId` rather than LNURL because the
 * detail screen never sees the bearer string, only the public coord.
 */
export const lastClaimForPiggyId = async (piggyId: string): Promise<ClaimHistoryEntry | null> => {
  const list = await loadClaimHistory();
  return list.find((e) => e.piggyId === piggyId) ?? null;
};

const isValidEntry = (v: unknown): v is ClaimHistoryEntry => {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  if (typeof e.lnurlHash !== 'string') return false;
  if (typeof e.claimedAt !== 'number') return false;
  if (typeof e.sats !== 'number') return false;
  if (e.piggyId !== undefined && typeof e.piggyId !== 'string') return false;
  return true;
};
