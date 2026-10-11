/**
 * Relay health for the shared Nostr pool (#1326).
 *
 * The app talks to a fixed set of default / lookup relays plus whatever the
 * user's contacts publish in their kind-10002 lists. When one of those relays
 * dies, every query that waits for all relays to answer pays its full connect
 * timeout, again and again. This module remembers which relays failed to
 * connect and parks them for a while, so the pool skips them (see
 * `HealthAwarePool` in `./nostrPool`).
 *
 * Modelled on `./nwcRelayHealth`, keyed by normalised relay URL:
 *
 *  - Only connect failures and connect timeouts count. A relay that connected
 *    and then refused a query is reachable, so it isn't "dead".
 *  - `PARK_AFTER_FAILURES` consecutive counted failures park a relay for
 *    `PARK_BASE_MS` (15 min), doubling per further failure up to
 *    `PARK_MAX_MS` (6 h). When the park lapses the relay gets one fresh try:
 *    success clears everything, another failure re-parks it for twice as long.
 *  - A failure only counts when some OTHER relay connected within
 *    `CORROBORATION_WINDOW_MS` of it. With no network at all, every relay
 *    fails and none succeeds, so an offline phone doesn't park the whole
 *    list. A failure seen before any success (common at cold start, when a
 *    refused connection beats the healthy relays' TLS handshakes) is held as
 *    "unconfirmed" and counted once a success inside the window confirms the
 *    network works.
 *  - `selectHealthyRelays` never drops every relay in a request. It keeps at
 *    least the `MIN_RELAYS_KEPT` (2) healthiest, so a list made only of
 *    parked relays is still tried, and those tries double as recovery probes.
 *
 * State is in memory, with a debounced AsyncStorage copy of the failing and
 * parked entries only, so a relay known to be dead is skipped from the first
 * query after a cold start. No subscriptions, no React state: callers ask
 * synchronously per request.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeURL } from 'nostr-tools/utils';

export const PARK_AFTER_FAILURES = 2;
export const PARK_BASE_MS = 15 * 60_000;
export const PARK_MAX_MS = 6 * 3600_000;
/** `selectHealthyRelays` keeps at least this many relays per request. */
export const MIN_RELAYS_KEPT = 2;
/** A failure counts only if another relay connected within this window. */
export const CORROBORATION_WINDOW_MS = 30_000;
/**
 * Upper bound on any pool connection attempt. nostr-tools otherwise derives
 * the connect timeout from `maxWait` (80 % of it), so a 15 s query waited
 * 12 s on a relay that never answers the TCP handshake.
 */
export const RELAY_CONNECT_TIMEOUT_MS = 5_000;
/** Why a skipped relay's publish promise rejects. */
export const RELAY_SKIPPED_REASON = 'relay skipped: unhealthy (recent connection failures)';

const STORAGE_KEY = 'nostr_relay_health_v1';
const PERSIST_DEBOUNCE_MS = 2_000;
/** Bound on remembered relays (user lists can name hundreds over time). */
const MAX_ENTRIES = 200;

interface RelayHealthEntry {
  /** Consecutive counted connect failures since the last success. */
  failures: number;
  /** Epoch ms until which the relay is skipped; 0 when not parked. */
  parkedUntil: number;
  lastFailureAt: number;
  /** A failure seen while nothing else had connected recently. */
  unconfirmedAt?: number;
}

const entries = new Map<string, RelayHealthEntry>();
let lastAnySuccessAt = 0;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

/** Normalise like the pool does, so `wss://x` and `wss://X/` share an entry. */
export function relayKey(url: string): string {
  try {
    return normalizeURL(url);
  } catch {
    return url.trim();
  }
}

function backoffMs(failures: number): number {
  return Math.min(PARK_BASE_MS * 2 ** (failures - PARK_AFTER_FAILURES), PARK_MAX_MS);
}

function countFailure(key: string, entry: RelayHealthEntry, at: number): void {
  entry.failures += 1;
  entry.lastFailureAt = at;
  if (entry.failures >= PARK_AFTER_FAILURES) {
    const ms = backoffMs(entry.failures);
    entry.parkedUntil = at + ms;
    if (__DEV__) {
      console.log(
        `[RelayHealth] parked ${key} for ${Math.round(ms / 60_000)} min ` +
          `after ${entry.failures} connect failures`,
      );
    }
  }
  schedulePersist();
}

function evictIfFull(): void {
  if (entries.size <= MAX_ENTRIES) return;
  // Drop the entries whose last failure is oldest.
  const byAge = [...entries.entries()].sort((a, b) => a[1].lastFailureAt - b[1].lastFailureAt);
  for (const [key] of byAge.slice(0, entries.size - MAX_ENTRIES)) entries.delete(key);
}

/** A NEW connection to `url` opened (not a reused, already-open socket). */
export function recordRelaySuccess(url: string, now: number = Date.now()): void {
  lastAnySuccessAt = now;
  const own = relayKey(url);
  const ownEntry = entries.get(own);
  if (ownEntry) {
    entries.delete(own);
    if (ownEntry.failures > 0) schedulePersist();
  }
  // The network works: failures held as unconfirmed within the window were
  // real relay failures, not an offline phone.
  for (const [key, entry] of entries) {
    if (entry.unconfirmedAt === undefined) continue;
    const at = entry.unconfirmedAt;
    entry.unconfirmedAt = undefined;
    if (now - at <= CORROBORATION_WINDOW_MS) countFailure(key, entry, at);
    else if (entry.failures === 0) entries.delete(key);
  }
}

/** Connecting to `url` failed or timed out (not aborted by the caller). */
export function recordRelayFailure(url: string, now: number = Date.now()): void {
  const key = relayKey(url);
  let entry = entries.get(key);
  if (!entry) {
    entry = { failures: 0, parkedUntil: 0, lastFailureAt: now };
    entries.set(key, entry);
    evictIfFull();
  }
  if (now - lastAnySuccessAt <= CORROBORATION_WINDOW_MS) countFailure(key, entry, now);
  else entry.unconfirmedAt = now;
}

export function isRelayParked(url: string, now: number = Date.now()): boolean {
  const entry = entries.get(relayKey(url));
  return entry !== undefined && entry.parkedUntil > now;
}

/**
 * The relays of `urls` worth contacting, in their original order and
 * spelling. Parked relays are dropped, but never all of them: if fewer than
 * `MIN_RELAYS_KEPT` distinct relays (or all of them, for a shorter list)
 * would remain, the healthiest parked ones are added back, soonest-to-expire
 * first, then fewest failures.
 */
export function selectHealthyRelays(urls: readonly string[], now: number = Date.now()): string[] {
  if (entries.size === 0 || urls.length === 0) return [...urls];
  const keys = urls.map(relayKey);
  const distinct = new Set(keys);
  const parked = new Set([...distinct].filter((k) => isRelayParked(k, now)));
  if (parked.size === 0) return [...urls];

  const allowed = new Set([...distinct].filter((k) => !parked.has(k)));
  const need = Math.min(MIN_RELAYS_KEPT, distinct.size);
  if (allowed.size < need) {
    const healthiestParked = [...parked].sort((a, b) => {
      const ea = entries.get(a)!;
      const eb = entries.get(b)!;
      return ea.parkedUntil - eb.parkedUntil || ea.failures - eb.failures;
    });
    for (const k of healthiestParked) {
      if (allowed.size >= need) break;
      allowed.add(k);
    }
  }
  return urls.filter((_, i) => allowed.has(keys[i]));
}

/** Parked relays right now, for logs and debugging. */
export function parkedRelays(now: number = Date.now()): { url: string; until: number }[] {
  return [...entries.entries()]
    .filter(([, e]) => e.parkedUntil > now)
    .map(([url, e]) => ({ url, until: e.parkedUntil }));
}

// --- persistence -----------------------------------------------------------

type StoredEntry = { u: string; f: number; p: number; l: number };

function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistNow();
  }, PERSIST_DEBOUNCE_MS);
}

async function persistNow(): Promise<void> {
  const stored: StoredEntry[] = [];
  for (const [u, e] of entries) {
    if (e.failures > 0) stored.push({ u, f: e.failures, p: e.parkedUntil, l: e.lastFailureAt });
  }
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Best effort: in-memory health still works.
  }
}

/**
 * Load the persisted entries. Entries already learned this session win, and
 * anything whose park ended more than `PARK_MAX_MS` ago is forgotten.
 */
export async function hydrateRelayHealth(now: number = Date.now()): Promise<void> {
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(STORAGE_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (!Array.isArray(parsed)) return;
  for (const item of parsed as Partial<StoredEntry>[]) {
    if (
      !item ||
      typeof item.u !== 'string' ||
      typeof item.f !== 'number' ||
      typeof item.p !== 'number' ||
      typeof item.l !== 'number' ||
      item.f <= 0
    ) {
      continue;
    }
    if (Math.max(item.p, item.l) + PARK_MAX_MS < now) continue;
    if (entries.has(item.u)) continue;
    entries.set(item.u, { failures: item.f, parkedUntil: item.p, lastFailureAt: item.l });
  }
  evictIfFull();
}

/** Test seam: wipe state and cancel a pending write. */
export function __resetRelayHealthForTests(): void {
  entries.clear();
  lastAnySuccessAt = 0;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = null;
}

/** Test seam: write the persisted copy immediately. */
export async function __persistRelayHealthForTests(): Promise<void> {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = null;
  await persistNow();
}
