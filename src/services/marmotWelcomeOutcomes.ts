// What became of each Marmot invite (kind-444 Welcome) this account received,
// so the NIP-17 inbox can hide the invite's gift wrap once it's joined and
// explain the ones that couldn't be opened (#1269).
//
// Kept in the session's existing per-account `welcomes` marker (written when
// a Welcome is joined or permanently rejected) — not a new store. Markers
// written before #1269 hold a bare timestamp; they parse as "unknown" and
// stay hidden, as they always were.

import {
  getWelcome,
  getWelcomeKeyPackageEventId,
  type NostrNetworkInterface,
} from '@internet-privacy/marmot-ts';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import type { MarmotKvBackend } from './marmotStore';
import { MALFORMED_WELCOME } from './marmotWelcomeFailure';

export const WELCOME_OUTCOMES_NS = 'welcomes';
const PENDING_NS = 'pendingWelcomes';
const ATTEMPTS_NS = 'welcomeAttempts';
const KEY_PACKAGE_KIND = 30443;
/** A retryable join that has failed this many times is shown as failed (it's
 * still retried — a later success hides the row again). */
export const STUCK_AFTER_ATTEMPTS = 3;
const LOOKUP_TIMEOUT_MS = 8_000;

/**
 * - `joined`: we're in the group (from this Welcome, or it re-invites a group
 *   we already hold).
 * - `failed`: no key on this device opens it and it wasn't meant for another
 *   of our devices, or it's malformed — worth telling the user.
 * - `otherDevice`: addressed to another of our devices' invitation keys (a
 *   second phone, our White Noise install) — not a failure from here.
 * - `unverified`: no key here opens it, but whose key it named couldn't be
 *   checked yet (relays unreachable). Hidden; re-checked each session start.
 */
export type WelcomeResult = 'joined' | 'failed' | 'otherDevice' | 'unverified';
const RESULTS: readonly WelcomeResult[] = ['joined', 'failed', 'otherDevice', 'unverified'];
export type WelcomeFailureReason = 'noKey' | 'malformed' | 'joinFailed';

export interface WelcomeOutcome {
  result: WelcomeResult;
  reason?: WelcomeFailureReason;
  /** Inviter (the rumor author), lowercase hex. */
  sender: string;
  /** The rumor's own `created_at` (the gift wrap's is randomised). */
  createdAt: number;
  /** Fingerprint of the commit the Welcome came from: every per-device
   * Welcome of one invite shares its encrypted GroupInfo. */
  commit?: string;
  /** The kind-30443 event the Welcome names (`unverified` re-checks it). */
  keyPackageId?: string;
  /** When we decided (unix seconds). */
  at: number;
}

/** A failed invite the user should hear about. */
export interface FailedMarmotInvite {
  /** The Welcome rumor id. */
  id: string;
  sender: string;
  createdAt: number;
  reason: WelcomeFailureReason;
}

interface WelcomeRumorLike {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

/** sha256 of the Welcome's encrypted GroupInfo, or undefined if undecodable. */
export function welcomeCommitFingerprint(rumor: WelcomeRumorLike): string | undefined {
  try {
    return bytesToHex(sha256(getWelcome(rumor).encryptedGroupInfo));
  } catch {
    return undefined;
  }
}

/** The key package event id the Welcome names (its `e` tag), if valid. */
export function welcomeKeyPackageId(rumor: WelcomeRumorLike): string | undefined {
  try {
    return getWelcomeKeyPackageEventId(rumor);
  } catch {
    return undefined;
  }
}

export function buildWelcomeOutcome(
  rumor: WelcomeRumorLike,
  result: WelcomeResult,
  reason?: WelcomeFailureReason,
): WelcomeOutcome {
  const commit = welcomeCommitFingerprint(rumor);
  const keyPackageId = result === 'unverified' ? welcomeKeyPackageId(rumor) : undefined;
  return {
    result,
    ...(reason ? { reason } : {}),
    sender: rumor.pubkey.toLowerCase(),
    createdAt: rumor.created_at,
    ...(commit ? { commit } : {}),
    ...(keyPackageId ? { keyPackageId } : {}),
    at: Math.floor(Date.now() / 1000),
  };
}

/** Null for a pre-#1269 timestamp marker or anything unreadable. */
export function parseWelcomeOutcome(raw: string | null): WelcomeOutcome | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<WelcomeOutcome> | number;
    if (!v || typeof v !== 'object') return null;
    if (!RESULTS.includes(v.result as WelcomeResult)) return null;
    if (typeof v.sender !== 'string' || typeof v.createdAt !== 'number') return null;
    return v as WelcomeOutcome;
  } catch {
    return null;
  }
}

/** A retryable join that keeps failing, with its commit fingerprint. */
export interface StuckWelcome extends FailedMarmotInvite {
  commit?: string;
}

/**
 * The failures worth showing: `failed` outcomes and retryable joins that keep
 * failing — unless a sibling Welcome of the same commit was joined (a contact
 * inviting several of our devices sends one per device; joining one makes the
 * others moot). Oldest first.
 */
export function visibleFailedInvites(
  outcomes: ReadonlyMap<string, WelcomeOutcome>,
  stuck: readonly StuckWelcome[] = [],
): FailedMarmotInvite[] {
  const joinedCommits = new Set<string>();
  for (const o of outcomes.values()) {
    if (o.result === 'joined' && o.commit) joinedCommits.add(o.commit);
  }
  const superseded = (commit?: string) => !!commit && joinedCommits.has(commit);
  const out: FailedMarmotInvite[] = [];
  for (const [id, o] of outcomes) {
    if (o.result !== 'failed' || superseded(o.commit)) continue;
    out.push({ id, sender: o.sender, createdAt: o.createdAt, reason: o.reason ?? 'noKey' });
  }
  for (const { commit, ...s } of stuck) {
    if (!outcomes.has(s.id) && !superseded(commit)) out.push(s);
  }
  return out.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

async function readOutcomes(backend: MarmotKvBackend): Promise<Map<string, WelcomeOutcome>> {
  const outcomes = new Map<string, WelcomeOutcome>();
  for (const id of await backend.keys(WELCOME_OUTCOMES_NS)) {
    const o = parseWelcomeOutcome(await backend.get(WELCOME_OUTCOMES_NS, id));
    if (o) outcomes.set(id, o);
  }
  return outcomes;
}

/** Read every outcome + stuck pending Welcome from `backend` (one account). */
export async function loadFailedInvites(backend: MarmotKvBackend): Promise<FailedMarmotInvite[]> {
  const outcomes = await readOutcomes(backend);
  const stuck: StuckWelcome[] = [];
  for (const id of await backend.keys(ATTEMPTS_NS)) {
    if (Number(await backend.get(ATTEMPTS_NS, id)) < STUCK_AFTER_ATTEMPTS) continue;
    try {
      const rumor = JSON.parse((await backend.get(PENDING_NS, id)) ?? '') as WelcomeRumorLike;
      const sender = rumor.pubkey.toLowerCase();
      const commit = welcomeCommitFingerprint(rumor);
      stuck.push({ id, sender, createdAt: rumor.created_at, reason: 'joinFailed', commit });
    } catch {
      // no longer pending (joined / dropped) — nothing to show
    }
  }
  return visibleFailedInvites(outcomes, stuck);
}

/** Record a retryable failure; returns the attempt count so far. */
export async function countWelcomeAttempt(backend: MarmotKvBackend, id: string): Promise<number> {
  const n = (Number(await backend.get(ATTEMPTS_NS, id)) || 0) + 1;
  await backend.set(ATTEMPTS_NS, id, String(n));
  return n;
}

export async function forgetWelcomeAttempts(backend: MarmotKvBackend, id: string): Promise<void> {
  await backend.remove(ATTEMPTS_NS, id);
}

export interface KeyPackageLookup {
  network: Pick<NostrNetworkInterface, 'request'>;
  relays: string[];
  owner: string;
  /** This install's `d` slot; null if it never published a key package. */
  ownSlot: string | null;
}

/** The outcome for a Welcome that can never be joined here (see
 * `isPermanentWelcomeFailure`): malformed, another device's, or failed —
 * `unverified` while whose key it named can't be checked. */
export async function permanentFailureOutcome(
  rumor: WelcomeRumorLike,
  error: unknown,
  lookup: KeyPackageLookup,
): Promise<WelcomeOutcome> {
  const message = String((error as Error)?.message ?? error);
  if (MALFORMED_WELCOME.test(message) || welcomeCommitFingerprint(rumor) === undefined) {
    return buildWelcomeOutcome(rumor, 'failed', 'malformed');
  }
  const owner = await keyPackageOwner(welcomeKeyPackageId(rumor), lookup);
  if (owner === 'otherDevice') return buildWelcomeOutcome(rumor, 'otherDevice');
  if (owner === 'unknown') return buildWelcomeOutcome(rumor, 'unverified', 'noKey');
  return buildWelcomeOutcome(rumor, 'failed', 'noKey');
}

/** Re-check `unverified` outcomes (relays may be reachable now). Returns
 * whether any changed. */
export async function reverifyWelcomeOutcomes(
  backend: MarmotKvBackend,
  lookup: KeyPackageLookup,
): Promise<boolean> {
  let changed = false;
  for (const [id, o] of await readOutcomes(backend)) {
    if (o.result !== 'unverified') continue;
    const owner = await keyPackageOwner(o.keyPackageId, lookup);
    if (owner === 'unknown') continue;
    const result: WelcomeResult = owner === 'otherDevice' ? 'otherDevice' : 'failed';
    const settled: WelcomeOutcome = { ...o, result };
    delete settled.keyPackageId;
    await backend.set(WELCOME_OUTCOMES_NS, id, JSON.stringify(settled));
    changed = true;
  }
  return changed;
}

/**
 * Whose invitation key a Welcome named: `otherDevice` when the kind-30443
 * event is ours but in another install's `d` slot (or we never published one);
 * `notOurs` when it's in our own slot, a stranger's, or gone from relays (an
 * old, deleted key — worth telling the user); `unknown` when relays couldn't
 * be asked.
 */
export async function keyPackageOwner(
  keyPackageId: string | undefined,
  { network, relays, owner, ownSlot }: KeyPackageLookup,
): Promise<'otherDevice' | 'notOurs' | 'unknown'> {
  if (!keyPackageId) return 'notOurs';
  if (relays.length === 0) return 'unknown';
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const events = await Promise.race([
      network.request(relays, { ids: [keyPackageId], kinds: [KEY_PACKAGE_KIND], limit: 1 }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), LOOKUP_TIMEOUT_MS);
      }),
    ]);
    const kp = events.find((e) => e.id === keyPackageId);
    if (!kp || kp.pubkey.toLowerCase() !== owner.toLowerCase()) return 'notOurs';
    const slot = kp.tags.find((t) => t[0] === 'd')?.[1];
    return slot && slot !== ownSlot ? 'otherDevice' : 'notOurs';
  } catch {
    return 'unknown';
  } finally {
    if (timer) clearTimeout(timer);
  }
}
