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
 *    was in flight when that happened neither writes a file nor fills the
 *    memory cache.
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
// Resolves waiting in `waitForOwner` until an account becomes active.
let ownerWaiters: (() => void)[] = [];
const OWNER_WAIT_MS = 15_000;
let legacyCleanupTimer: ReturnType<typeof setTimeout> | null = null;

const hex = (s: string) => bytesToHex(sha256(utf8ToBytes(s)));

function cacheBase(): string | null {
  if (!cacheDirectory) return null;
  return cacheDirectory.endsWith('/') ? cacheDirectory : `${cacheDirectory}/`;
}

/** The directory name for an owner — a hash, so the pubkey isn't on disk. */
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
  if (next) {
    const waiters = ownerWaiters;
    ownerWaiters = [];
    waiters.forEach((wake) => wake());
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

/** The active owner, waiting up to OWNER_WAIT_MS for one to be set. */
function waitForOwner(): Promise<string> {
  return new Promise((resolve, reject) => {
    const wake = () => {
      clearTimeout(timer);
      if (activeOwner) resolve(activeOwner);
      else reject(new Error('No active account for decrypted media'));
    };
    const timer = setTimeout(() => {
      ownerWaiters = ownerWaiters.filter((w) => w !== wake);
      wake();
    }, OWNER_WAIT_MS);
    ownerWaiters.push(wake);
  });
}

/**
 * Resolve an encrypted attachment to a decrypted `file://` URI for the active
 * account: memory → this account's disk cache → fetch + decrypt + write.
 * Rejects on fetch / decrypt failure (wrong keys, bad hashes) and with
 * `DecryptedMediaCancelledError` if the account's session ended meanwhile.
 */
export async function resolveDecryptedMedia(ref: EncryptedMediaRef): Promise<string> {
  // A cold start can mount a bubble (e.g. a restored group chat, whose
  // messages aren't per-account yet) before the session's pubkey lands.
  const owner = activeOwner ?? (await waitForOwner());
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
    await makeDirectoryAsync(dir, { intermediates: true });
    await writeAsStringAsync(uri, Buffer.from(plain).toString('base64'), { encoding: 'base64' });
    if (generationOf(ownerDir) !== gen) {
      // Wiped / switched while writing: don't leave the plaintext behind.
      await deleteAsync(uri, { idempotent: true }).catch(() => {});
      throw new DecryptedMediaCancelledError();
    }
  }
  assertCurrent();
  remember(memoKey, uri);
  return uri;
}

/**
 * Delete every decrypted file belonging to `pubkey` and forget its memory
 * entries; cancels its in-flight decrypts. Called from `wipeAccountCaches`.
 */
export async function wipeDecryptedMediaForOwner(pubkey: string): Promise<void> {
  const ownerDir = ownerDirName(pubkey);
  bump(ownerDir);
  for (const k of [...memory.keys()]) if (k.startsWith(`${ownerDir}/`)) memory.delete(k);
  for (const k of [...inflight.keys()]) if (k.startsWith(`${ownerDir}/`)) inflight.delete(k);
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
  await Promise.allSettled(
    names
      .filter((n) => LEGACY_FILE_RE.test(n))
      .map((n) => deleteAsync(`${base}${n}`, { idempotent: true })),
  );
  await AsyncStorage.setItem(LEGACY_CLEANUP_FLAG_KEY, '1');
}

/** Test-only: reset module state between cases. */
export function __resetDecryptedMediaCacheForTests(): void {
  memory.clear();
  inflight.clear();
  generations.clear();
  activeOwner = null;
  ownerWaiters = [];
  if (legacyCleanupTimer) clearTimeout(legacyCleanupTimer);
  legacyCleanupTimer = null;
}
