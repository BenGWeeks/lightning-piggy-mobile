// Per-account "read up to here" positions for every chat (#1295): 1:1 threads
// on any protocol and groups (NIP-17 and Marmot). One small AsyncStorage blob
// per account — `chat_read_positions_v1_<pubkey>` — holding a marker per
// conversation, kept in memory and written back at most once per
// PERSIST_DELAY_MS however fast the reader scrolls (no per-message writes).
//
// A conversation with no marker yet reads at the account's `baseline`: the
// moment this store first ran for the account. Messages from before the
// feature shipped count as read, so upgrading doesn't light up every chat;
// anything newer is unread until seen.
//
// Subscribers (the Messages list's `@` badges) are told on hydrate and on
// each flush, not on every mark — the open chat tracks its live position
// itself, so the list only needs the coalesced result.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { perAccountKey } from './perAccountStorage';
import { advanceReadMarker, type ReadMarker } from '../utils/chatUnread';

export const CHAT_READ_POSITIONS_KEY_BASE = 'chat_read_positions_v1';
/** Coalescing window for writes + list notifications. */
export const PERSIST_DELAY_MS = 1500;
/** Keep the blob bounded: the oldest-read conversations drop off first. */
const MAX_CONVERSATIONS = 500;

interface StoredBlob {
  v: 1;
  baseline: number;
  markers: Record<string, ReadMarker>;
}

interface AccountState {
  /** Null until hydrated. */
  baseline: number | null;
  markers: Record<string, ReadMarker>;
  timer: ReturnType<typeof setTimeout> | null;
  dirty: boolean;
}

const accounts = new Map<string, AccountState>();
const hydrations = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
let version = 0;
// Per account, bumped by forgetReadPositions so a read still in flight at
// that account's sign-out can't resurrect (or re-write) its positions.
const generations = new Map<string, number>();

export const dmReadKey = (peerPubkey: string) => `dm:${peerPubkey.toLowerCase()}`;
export const groupReadKey = (groupId: string) => `group:${groupId}`;

const nowSec = () => Math.floor(Date.now() / 1000);
const ownerOf = (owner: string) => owner.toLowerCase();

function stateFor(owner: string): AccountState {
  const key = ownerOf(owner);
  let state = accounts.get(key);
  if (!state) {
    state = { baseline: null, markers: {}, timer: null, dirty: false };
    accounts.set(key, state);
  }
  return state;
}

function notify(): void {
  version++;
  for (const fn of listeners) fn();
}

function isMarker(value: unknown): value is ReadMarker {
  if (!value || typeof value !== 'object') return false;
  const m = value as ReadMarker;
  return (
    typeof m.at === 'number' &&
    Number.isFinite(m.at) &&
    (m.id === undefined || typeof m.id === 'string')
  );
}

function parseBlob(raw: string | null): StoredBlob | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredBlob>;
    if (typeof parsed?.baseline !== 'number' || !Number.isFinite(parsed.baseline)) return null;
    const markers: Record<string, ReadMarker> = {};
    if (parsed.markers && typeof parsed.markers === 'object') {
      for (const [k, m] of Object.entries(parsed.markers)) {
        if (isMarker(m)) markers[k] = m.id ? { at: m.at, id: m.id } : { at: m.at };
      }
    }
    return { v: 1, baseline: parsed.baseline, markers };
  } catch {
    return null;
  }
}

function pruned(markers: Record<string, ReadMarker>): Record<string, ReadMarker> {
  const entries = Object.entries(markers);
  if (entries.length <= MAX_CONVERSATIONS) return markers;
  entries.sort((a, b) => b[1].at - a[1].at);
  return Object.fromEntries(entries.slice(0, MAX_CONVERSATIONS));
}

/** Load the account's positions (once; concurrent callers share the read). */
export function hydrateReadPositions(owner: string | null | undefined): Promise<void> {
  if (!owner) return Promise.resolve();
  const key = ownerOf(owner);
  if (accounts.get(key)?.baseline != null) return Promise.resolve();
  const inFlight = hydrations.get(key);
  if (inFlight) return inFlight;
  const startGeneration = generations.get(key) ?? 0;
  const run = (async () => {
    let blob: StoredBlob | null = null;
    try {
      blob = parseBlob(
        await AsyncStorage.getItem(perAccountKey(CHAT_READ_POSITIONS_KEY_BASE, key)),
      );
    } catch {
      blob = null;
    }
    if ((generations.get(key) ?? 0) !== startGeneration) return;
    const state = stateFor(key);
    // Marks made before the read landed (a chat opened instantly) win where newer.
    const merged: Record<string, ReadMarker> = { ...(blob?.markers ?? {}) };
    for (const [conv, m] of Object.entries(state.markers)) {
      merged[conv] = advanceReadMarker(merged[conv] ?? null, m);
    }
    state.markers = merged;
    state.baseline = blob?.baseline ?? nowSec();
    // First run for this account (record the baseline), or marks to merge.
    if (!blob || state.dirty) schedulePersist(key, state);
    notify();
  })().finally(() => {
    if (hydrations.get(key) === run) hydrations.delete(key);
  });
  hydrations.set(key, run);
  return run;
}

/** The conversation's read position, or null until the account is hydrated. */
export function getReadMarker(
  owner: string | null | undefined,
  conversationKey: string,
): ReadMarker | null {
  if (!owner) return null;
  const state = accounts.get(ownerOf(owner));
  if (!state || state.baseline === null) return null;
  return state.markers[conversationKey] ?? { at: state.baseline };
}

function schedulePersist(owner: string, state: AccountState): void {
  state.dirty = true;
  if (state.timer !== null) return; // already queued: this mark rides along
  state.timer = setTimeout(() => {
    state.timer = null;
    void persist(owner, state);
  }, PERSIST_DELAY_MS);
}

async function persist(owner: string, state: AccountState): Promise<void> {
  if (!state.dirty || state.baseline === null) return;
  state.dirty = false;
  state.markers = pruned(state.markers);
  notify();
  const blob: StoredBlob = { v: 1, baseline: state.baseline, markers: state.markers };
  try {
    await AsyncStorage.setItem(
      perAccountKey(CHAT_READ_POSITIONS_KEY_BASE, owner),
      JSON.stringify(blob),
    );
  } catch {
    // Non-fatal: memory still holds the position for this session.
  }
}

/**
 * Record that the viewer has seen up to `marker` in a conversation. Only ever
 * moves forward; the write and the list update are coalesced.
 */
export function markConversationRead(
  owner: string | null | undefined,
  conversationKey: string,
  marker: ReadMarker,
): void {
  if (!owner) return;
  const key = ownerOf(owner);
  const state = stateFor(key);
  const prev = state.markers[conversationKey] ?? null;
  const next = advanceReadMarker(prev, marker);
  if (next === prev) return;
  state.markers = { ...state.markers, [conversationKey]: next };
  if (state.baseline === null) {
    void hydrateReadPositions(key);
    state.dirty = true;
    return; // hydrate merges this mark, then persists on the next mark / flush
  }
  schedulePersist(key, state);
}

/** Write any pending positions now (a chat closing, or tests). */
export async function flushReadPositions(owner?: string | null): Promise<void> {
  const owners = owner ? [ownerOf(owner)] : [...accounts.keys()];
  await Promise.all(
    owners.map(async (key) => {
      const state = accounts.get(key);
      if (!state) return;
      if (state.timer !== null) {
        clearTimeout(state.timer);
        state.timer = null;
      }
      await persist(key, state);
    }),
  );
}

/** Drop an account's in-memory positions (sign-out; the key is wiped separately). */
export function forgetReadPositions(owner: string | null | undefined): void {
  if (!owner) return;
  const key = ownerOf(owner);
  const state = accounts.get(key);
  if (state?.timer) clearTimeout(state.timer);
  accounts.delete(key);
  hydrations.delete(key);
  generations.set(key, (generations.get(key) ?? 0) + 1);
  notify();
}

export function subscribeReadPositions(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Bumps on every hydrate / flush — the useSyncExternalStore snapshot. */
export function getReadPositionsVersion(): number {
  return version;
}

/** Test-only: reset module state. */
export function __resetReadPositionsForTests(): void {
  for (const state of accounts.values()) if (state.timer) clearTimeout(state.timer);
  accounts.clear();
  hydrations.clear();
  generations.clear();
  listeners.clear();
  version = 0;
}
