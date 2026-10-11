/**
 * decryptedMediaCache — the one place encrypted chat media (voice notes and
 * photos, NIP-17 kind 15 and Marmot MIP-04) is fetched, decrypted and cached
 * as a playable / displayable `file://` URI.
 *
 * Decrypted media is plaintext, so it follows the same rule as the DM stores
 * (#689): it belongs to one account and must not outlive it.
 *
 *  - **Per account on disk.** Files live under
 *    `cacheDirectory/decrypted/<sha256(owner)>/`, so `wipeDecryptedMediaForOwner`
 *    can delete one account's media without touching another's.
 *  - **Bound to the key material.** The cache key is a hash of the URL AND the
 *    key / nonce / Marmot params. A hit therefore only happens for a caller
 *    holding exactly the keys the original (authenticated) decrypt succeeded
 *    with, so a message pointing at a cached URL with other keys can't be
 *    served someone else's plaintext without decrypting.
 *  - **Generation token.** Each owner has a generation, bumped when its media
 *    is wiped or its session ends (account switch / sign-out). A decrypt that
 *    was in flight when that happened never fills the memory cache, and only
 *    publishes a file if it was already past its last check — on a wipe the
 *    wipe waits for that publish and then deletes the folder; on a switch the
 *    file lands in the outgoing account's own folder.
 *  - **Sessions.** Only a cold start (no account yet in this process) waits
 *    for an owner; a request made between sessions is cancelled, so one
 *    account's media can never be decrypted into the next account's folder.
 *  - **Legacy cleanup.** Before #1241 the components wrote device-wide
 *    `lp-voice-*` / `lp-img-*` files straight into `cacheDirectory`; they are
 *    deleted once after upgrade (and on any sign-out until that has run).
 *
 * The active owner is set by `useIdentityMemoryReset` (a layout effect on the
 * provider's pubkey), so the media components don't need the pubkey threaded
 * through every bubble.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  cacheDirectory,
  deleteAsync,
  getInfoAsync,
  makeDirectoryAsync,
  moveAsync,
  readDirectoryAsync,
  writeAsStringAsync,
} from 'expo-file-system/legacy';
import { Buffer } from 'buffer';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { decryptFile } from './encryptedFile';
import { decryptMarmotMedia } from './marmotMedia';
import type { MarmotImageParams } from '../utils/messageContent';

export type DecryptedMediaKind = 'voice' | 'image';

/** Everything needed to fetch + decrypt one attachment. */
export interface EncryptedMediaRef {
  url: string;
  kind: DecryptedMediaKind;
  mime?: string;
  /** NIP-17 (kind 15) AES-256-GCM key. */
  keyHex?: string;
  nonceHex?: string;
  /** A Marmot (MIP-04) attachment: decrypted with these instead of `keyHex`. */
  marmot?: MarmotImageParams;
}

/** Thrown when the owner's session ended / cache was wiped mid-decrypt. */
export class DecryptedMediaCancelledError extends Error {
  constructor() {
    super('decrypted media request cancelled (account changed or cache wiped)');
    this.name = 'DecryptedMediaCancelledError';
  }
}

const ROOT_DIR = 'decrypted';
export const LEGACY_CLEANUP_FLAG_KEY = 'decrypted_media_legacy_cleanup_v1';
const LEGACY_FILE_RE = /^lp-(voice|img)-/;
const LEGACY_CLEANUP_DELAY_MS = 5000;
// Bounded like the other module caches (#732 review): insertion-order eviction.
const MEMORY_CAP = 128;

// `<ownerDir>/<cacheKey>` → file:// uri, for the ACTIVE owner only.
const memory = new Map<string, string>();
// `<ownerDir>/<cacheKey>` → in-flight resolve, so a bubble and the fullscreen
// viewer opening the same photo share one fetch + decrypt.
const inflight = new Map<string, Promise<string>>();
// ownerDir → generation; see the header.
const generations = new Map<string, number>();
let activeOwner: string | null = null;
// "Not hydrated yet" vs "between sessions": only a cold start (no owner ever
// set in this process) may wait for one. Every owner change bumps the epoch.
let everHadOwner = false;
let sessionEpoch = 0;
type OwnerWaiter = (owner: string | null, epoch: number) => void;
// Requests waiting in `waitForOwner` for the first account to become active.
let ownerWaiters: OwnerWaiter[] = [];
// ownerDir → file publishes in flight, so a wipe can wait for them.
const publishing = new Map<string, Set<Promise<void>>>();
const OWNER_WAIT_MS = 15_000;
let legacyCleanupTimer: ReturnType<typeof setTimeout> | null = null;

const hex = (s: string) => bytesToHex(sha256(utf8ToBytes(s)));

function cacheBase(): string | null {
  if (!cacheDirectory) return null;
  return cacheDirectory.endsWith('/') ? cacheDirectory : `${cacheDirectory}/`;
}

/**
 * The directory name for an owner. A hash keeps the raw pubkey out of the
 * path, but an unsalted sha256 of a public key is still linkable to it —
 * this is tidiness, not anonymity.
 */
export function ownerDirName(owner: string): string {
  return hex(owner.toLowerCase());
}

function ownerDirUri(owner: string): string | null {
  const base = cacheBase();
  return base ? `${base}${ROOT_DIR}/${ownerDirName(owner)}/` : null;
}

/** Hash of the URL plus every piece of key material (see the header). */
export function mediaCacheKey(ref: EncryptedMediaRef): string {
  const m = ref.marmot;
  return hex(
    JSON.stringify([
      ref.url,
      ref.keyHex ?? '',
      ref.nonceHex ?? '',
      ref.mime ?? '',
      m ? [m.version, m.keysHex, m.filename, m.plaintextSha256, m.ciphertextSha256] : null,
    ]),
  );
}

function extensionFor(kind: DecryptedMediaKind, mime?: string): string {
  if (kind === 'image') {
    return (mime || 'image/jpeg').split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'jpg';
  }
  // Container hint for the audio player; m4a is our recorder's format.
  switch (mime) {
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/aac':
      return 'aac';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/wav':
      return 'wav';
    default:
      return 'm4a';
  }
}

const generationOf = (ownerDir: string) => generations.get(ownerDir) ?? 0;
const bump = (ownerDir: string) => generations.set(ownerDir, generationOf(ownerDir) + 1);

function remember(memoKey: string, uri: string): void {
  memory.set(memoKey, uri);
  while (memory.size > MEMORY_CAP) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
}

/**
 * Point the cache at the active account. Changing owner ends the previous
 * owner's session: its in-flight decrypts are cancelled and the memory cache
 * is dropped (its files stay on disk, so switching back is still fast).
 */
export function setDecryptedMediaOwner(pubkey: string | null): void {
  const next = pubkey ? pubkey.toLowerCase() : null;
  if (next === activeOwner) return;
  if (activeOwner) bump(ownerDirName(activeOwner));
  memory.clear();
  inflight.clear();
  activeOwner = next;
  sessionEpoch++;
  if (next) {
    everHadOwner = true;
    const waiters = ownerWaiters;
    ownerWaiters = [];
    waiters.forEach((wake) => wake(next, sessionEpoch));
  }
  if (next && !legacyCleanupTimer) {
    // Off the startup path; a one-off directory listing.
    legacyCleanupTimer = setTimeout(() => {
      cleanupLegacyDecryptedMedia().catch(() => {});
    }, LEGACY_CLEANUP_DELAY_MS);
  }
}

/** Drop the in-memory cache and cancel in-flight decrypts (identity reset). */
export function clearDecryptedMediaMemory(): void {
  if (activeOwner) bump(ownerDirName(activeOwner));
  memory.clear();
  inflight.clear();
}

/** Synchronous memory lookup (for seeding a bubble without a spinner). */
export function peekDecryptedMedia(ref: EncryptedMediaRef): string | null {
  if (!activeOwner) return null;
  return memory.get(`${ownerDirName(activeOwner)}/${mediaCacheKey(ref)}`) ?? null;
}

/** Cold start only: wait up to OWNER_WAIT_MS for the first owner. */
function waitForOwner(): Promise<{ owner: string; epoch: number }> {
  return new Promise((resolve, reject) => {
    const wake: OwnerWaiter = (owner, epoch) => {
      clearTimeout(timer);
      if (owner) resolve({ owner, epoch });
      else reject(new Error('No active account for decrypted media'));
    };
    const timer = setTimeout(() => {
      ownerWaiters = ownerWaiters.filter((w) => w !== wake);
      wake(null, sessionEpoch);
    }, OWNER_WAIT_MS);
    ownerWaiters.push(wake);
  });
}

/** The account a new request belongs to (see `everHadOwner`). */
async function requestOwner(): Promise<string> {
  if (activeOwner) return activeOwner;
  // Between sessions (after a sign-out / switch to nobody): the request
  // belongs to an account that's gone, so it must never land in the next one.
  if (everHadOwner) throw new DecryptedMediaCancelledError();
  // A cold start can mount a bubble (e.g. a restored group chat, whose
  // messages aren't per-account yet) before the session's pubkey lands.
  const { owner, epoch } = await waitForOwner();
  if (epoch !== sessionEpoch) throw new DecryptedMediaCancelledError();
  return owner;
}

/**
 * Resolve an encrypted attachment to a decrypted `file://` URI for the active
 * account: memory → this account's disk cache → fetch + decrypt + write.
 * Rejects on fetch / decrypt failure (wrong keys, bad hashes) and with
 * `DecryptedMediaCancelledError` if the account's session ended meanwhile.
 */
export async function resolveDecryptedMedia(ref: EncryptedMediaRef): Promise<string> {
  const owner = await requestOwner();
  const ownerDir = ownerDirName(owner);
  const memoKey = `${ownerDir}/${mediaCacheKey(ref)}`;
  const pending = inflight.get(memoKey);
  if (pending) return pending;
  const run = resolveUncached(ref, owner, ownerDir, memoKey).finally(() => {
    if (inflight.get(memoKey) === run) inflight.delete(memoKey);
  });
  inflight.set(memoKey, run);
  return run;
}

async function resolveUncached(
  ref: EncryptedMediaRef,
  owner: string,
  ownerDir: string,
  memoKey: string,
): Promise<string> {
  const gen = generationOf(ownerDir);
  const assertCurrent = () => {
    if (generationOf(ownerDir) !== gen) throw new DecryptedMediaCancelledError();
  };
  // A memory hit isn't proof the file survives: the OS can evict cacheDirectory.
  const memo = memory.get(memoKey);
  if (memo) {
    if ((await getInfoAsync(memo)).exists) {
      assertCurrent();
      return memo;
    }
    memory.delete(memoKey);
  }
  const dir = ownerDirUri(owner);
  if (!dir) throw new Error('No cache directory available for decrypted media');
  const { keyHex, nonceHex, marmot } = ref;
  if ((!keyHex && !marmot) || !nonceHex) throw new Error('Missing media key material');
  const uri = `${dir}${ref.kind}-${mediaCacheKey(ref)}.${extensionFor(ref.kind, ref.mime)}`;
  // Same name ⇒ same URL + keys ⇒ already decrypted by this account.
  if (!(await getInfoAsync(uri)).exists) {
    const res = await fetch(ref.url);
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    const cipher = new Uint8Array(await res.arrayBuffer());
    const plain = marmot
      ? decryptMarmotMedia(cipher, {
          mime: ref.mime ?? (ref.kind === 'voice' ? 'audio/mp4' : 'image/jpeg'),
          nonceHex,
          marmot,
        })
      : decryptFile(cipher, keyHex as string, nonceHex);
    assertCurrent();
    // Registered in the same tick as the check above, so a wipe that bumps
    // the generation after it will wait for this publish to settle.
    await trackPublish(ownerDir, publishFile(dir, uri, plain, ownerDir, gen));
  }
  assertCurrent();
  remember(memoKey, uri);
  return uri;
}

/**
 * Write to this writer's own temp file, then move it into place: a reader
 * never sees a half-written file, and a cancelled writer only ever deletes its
 * own temp — never a file a newer request already published.
 */
async function publishFile(
  dir: string,
  uri: string,
  plain: Uint8Array,
  ownerDir: string,
  gen: number,
): Promise<void> {
  const tmp = `${uri}.${gen}-${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await makeDirectoryAsync(dir, { intermediates: true });
    await writeAsStringAsync(tmp, Buffer.from(plain).toString('base64'), { encoding: 'base64' });
    // Wiped / switched while writing: don't publish.
    if (generationOf(ownerDir) !== gen) throw new DecryptedMediaCancelledError();
    if (!(await getInfoAsync(uri)).exists) await moveAsync({ from: tmp, to: uri });
  } finally {
    // Already gone after a successful move; on any failure (partial write,
    // cancelled, move error) never leave the plaintext temp behind.
    await deleteAsync(tmp, { idempotent: true }).catch(() => {});
  }
}

function trackPublish(ownerDir: string, publish: Promise<void>): Promise<void> {
  let set = publishing.get(ownerDir);
  if (!set) publishing.set(ownerDir, (set = new Set()));
  set.add(publish);
  const done = () => {
    set.delete(publish);
    if (set.size === 0 && publishing.get(ownerDir) === set) publishing.delete(ownerDir);
  };
  publish.then(done, done);
  return publish;
}

/**
 * Delete every decrypted file belonging to `pubkey` and forget its memory
 * entries; cancels its in-flight decrypts. Called from `wipeAccountCaches`.
 */
export async function wipeDecryptedMediaForOwner(pubkey: string): Promise<void> {
  const ownerDir = ownerDirName(pubkey);
  bump(ownerDir);
  // Signing out the active account retires its session right away: a bubble
  // mounting during the rest of the logout is cancelled, never decrypted for
  // it again — nor parked until the next account (whose folder it'd land in).
  if (activeOwner === pubkey.toLowerCase()) {
    activeOwner = null;
    sessionEpoch++;
  }
  for (const k of [...memory.keys()]) if (k.startsWith(`${ownerDir}/`)) memory.delete(k);
  for (const k of [...inflight.keys()]) if (k.startsWith(`${ownerDir}/`)) inflight.delete(k);
  // A publish already past its generation check may still move a file into
  // place; let it settle so the folder delete below catches it.
  await Promise.allSettled([...(publishing.get(ownerDir) ?? [])]);
  const dir = ownerDirUri(pubkey);
  if (dir) await deleteAsync(dir, { idempotent: true }).catch(() => {});
  // Legacy files aren't attributable to an owner — any sign-out removes them.
  await cleanupLegacyDecryptedMedia().catch(() => {});
}

/** One-time removal of the pre-#1241 device-wide `lp-voice-*` / `lp-img-*` files. */
export async function cleanupLegacyDecryptedMedia(): Promise<void> {
  if (await AsyncStorage.getItem(LEGACY_CLEANUP_FLAG_KEY)) return;
  const base = cacheBase();
  if (!base) return;
  const names = await readDirectoryAsync(base);
  const results = await Promise.allSettled(
    names
      .filter((n) => LEGACY_FILE_RE.test(n))
      .map((n) => deleteAsync(`${base}${n}`, { idempotent: true })),
  );
  // Only mark it done once every file is gone; otherwise retry next time.
  if (results.every((r) => r.status === 'fulfilled')) {
    await AsyncStorage.setItem(LEGACY_CLEANUP_FLAG_KEY, '1');
  }
}

/** Test-only: reset module state between cases. */
export function __resetDecryptedMediaCacheForTests(): void {
  memory.clear();
  inflight.clear();
  generations.clear();
  activeOwner = null;
  everHadOwner = false;
  sessionEpoch = 0;
  ownerWaiters = [];
  publishing.clear();
  if (legacyCleanupTimer) clearTimeout(legacyCleanupTimer);
  legacyCleanupTimer = null;
}
