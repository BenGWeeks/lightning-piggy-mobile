import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import { migrateDmStore } from '../services/dmStoreMigration';
import { importDmMessages, type DmMessageRow } from '../services/dmDb';
import type { DmInboxEntry } from '../utils/conversationSummaries';
import type { ConversationMessage } from './nostrContextTypes';
import {
  AMBER_NIP17_CACHE_KEY_BASE,
  NSEC_NIP17_CACHE_KEY_BASE,
  DM_CONV_CACHE_PREFIX,
  inboxCacheKey,
  wrapCacheFileName,
} from './nostrDmCache';

// One-time migration of the LAST plaintext DM blobs into the encrypted store
// (#850, second half of the at-rest story #848 started). Two AsyncStorage
// namespaces still held decrypted plaintext after the wrap-cache migration:
//
//   nostr_dm_inbox_v1_<owner>          — inbox previews (up to 1000 entries)
//   nostr_dm_conv_v1_<owner>_<peer>    — full threads (up to 500 msgs / peer)
//
// Their content is imported as `dm_messages` rows (fill-only: an existing
// encrypted row always wins; the import only supplies rows the store lacks —
// e.g. pre-#848 kind-4 threads — plus the delivery ticks (#856), rumor ids
// (#857) and optimistic local- rows the blobs were the sole carrier of).
// Then the blobs are deleted with verification, same strict ordering as #848
// (dmStoreMigration: populate → delete → verify → flag).
//
// N9 (#850): the migration's delete step also removes any pre-#288
// UNSUFFIXED wrap-cache remnants (`nsec_nip17_cache_v1` /
// `amber_nip17_cache_v1` without the `_<pubkey>` suffix, row or file). The
// #288 per-account migration renames them on its first run, but a rename
// that never completed would leave plaintext the suffixed-key wipes miss.
// They are deleted WITHOUT import: an unsuffixed cache can't be attributed
// to an owner on a multi-account device, and importing another identity's
// plaintext into this owner's rows would be worse than re-fetching from
// relays (the content is always re-fetchable + decrypt-once).

const BLOB_MIGRATED_FLAG_PREFIX = 'dm_blob_migrated_v1_';
export const dmBlobMigratedKey = (pubkey: string): string => BLOB_MIGRATED_FLAG_PREFIX + pubkey;

const HEX_64 = /^[0-9a-f]{64}$/;

const UNSUFFIXED_WRAP_BASES = [NSEC_NIP17_CACHE_KEY_BASE, AMBER_NIP17_CACHE_KEY_BASE] as const;

function safeParseArray<T>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/** A legacy inbox-preview entry → fill-only store row, or null if malformed.
 * Order previews (kind 16/17) are skipped: the blob held the *preview line*,
 * not the order JSON the store schema expects — the store either already has
 * the real row (live-sub upsert) or the order re-fetches from relays. */
export function inboxEntryToRow(owner: string, e: DmInboxEntry): DmMessageRow | null {
  if (!e || typeof e !== 'object') return null;
  if (typeof e.id !== 'string' || e.id.length === 0) return null;
  if (typeof e.partnerPubkey !== 'string' || !HEX_64.test(e.partnerPubkey)) return null;
  if (typeof e.text !== 'string' || !Number.isFinite(e.createdAt)) return null;
  const wireKind = typeof e.wireKind === 'number' ? e.wireKind : 14;
  if (wireKind === 16 || wireKind === 17) return null;
  return {
    owner,
    eventId: e.id,
    conversation: e.partnerPubkey,
    createdAt: e.createdAt,
    sender: e.fromMe ? owner : e.partnerPubkey,
    content: e.text,
    fromMe: e.fromMe === true,
    wireKind,
    ...(typeof e.rumorId === 'string' && e.rumorId.length > 0 ? { rumorId: e.rumorId } : {}),
  };
}

/** A legacy per-conversation blob entry → fill-only store row (carrying the
 * delivery tick / rumorId / optimistic local- rows), or null if malformed. */
export function convEntryToRow(
  owner: string,
  peer: string,
  m: ConversationMessage,
): DmMessageRow | null {
  if (!m || typeof m !== 'object') return null;
  if (typeof m.id !== 'string' || m.id.length === 0) return null;
  if (typeof m.text !== 'string' || !Number.isFinite(m.createdAt)) return null;
  return {
    owner,
    eventId: m.id,
    conversation: peer,
    createdAt: m.createdAt,
    sender: m.fromMe ? owner : peer,
    content: m.text,
    fromMe: m.fromMe === true,
    wireKind: typeof m.wireKind === 'number' ? m.wireKind : 14,
    ...(m.deliveryStatus ? { deliveryStatus: m.deliveryStatus } : {}),
    ...(typeof m.rumorId === 'string' && m.rumorId.length > 0 ? { rumorId: m.rumorId } : {}),
  };
}

/** This owner's per-conversation blob keys, with the peer parsed off each. */
async function listConvBlobKeys(pubkey: string): Promise<{ key: string; peer: string }[]> {
  const prefix = DM_CONV_CACHE_PREFIX + pubkey + '_';
  const allKeys = await AsyncStorage.getAllKeys();
  const out: { key: string; peer: string }[] = [];
  for (const key of allKeys) {
    if (!key.startsWith(prefix)) continue;
    const peer = key.slice(prefix.length);
    if (HEX_64.test(peer)) out.push({ key, peer });
    else out.push({ key, peer: '' }); // malformed peer — delete-only, no import
  }
  return out;
}

async function deleteUnsuffixedWrapCaches(): Promise<void> {
  for (const base of UNSUFFIXED_WRAP_BASES) {
    try {
      const f = new File(Paths.document, wrapCacheFileName(base));
      if (f.exists) f.delete();
    } catch {
      // verify step below decides whether this blocks the flag
    }
    await AsyncStorage.removeItem(base).catch(() => {});
  }
}

async function unsuffixedWrapCachesGone(): Promise<boolean> {
  for (const base of UNSUFFIXED_WRAP_BASES) {
    try {
      if (new File(Paths.document, wrapCacheFileName(base)).exists) return false;
    } catch {
      return false; // can't prove it's gone → treat as still present
    }
    if ((await AsyncStorage.getItem(base).catch(() => null)) != null) return false;
  }
  return true;
}

/**
 * Run the one-time plaintext-blob → encrypted-store migration for `pubkey`.
 * Same contract as the #848 wrap-cache migration: idempotent, interruption-
 * safe (flag only after a verified delete), never throws content away before
 * the DB import completed. Returns whether the migration is complete.
 */
export async function runDmBlobMigration(pubkey: string): Promise<boolean> {
  const result = await migrateDmStore({
    isMigrated: async () => (await AsyncStorage.getItem(dmBlobMigratedKey(pubkey))) === '1',
    setMigrated: async () => {
      await AsyncStorage.setItem(dmBlobMigratedKey(pubkey), '1');
    },
    populateEncryptedDb: async () => {
      let imported = 0;
      let dropped = 0;
      // Inbox previews. An unreadable row (>2 MB CursorWindow cap) parses to
      // [] — nothing to import, and the delete step removes it regardless.
      const inboxRaw = await AsyncStorage.getItem(inboxCacheKey(pubkey)).catch(() => null);
      const inboxRows: DmMessageRow[] = [];
      for (const entry of safeParseArray<DmInboxEntry>(inboxRaw)) {
        const row = inboxEntryToRow(pubkey, entry);
        if (row) inboxRows.push(row);
        else dropped++;
      }
      if (inboxRows.length > 0) await importDmMessages(inboxRows);
      imported += inboxRows.length;
      // Per-conversation threads — the richer source (full text + ticks +
      // rumor ids + optimistic local- rows), imported after the inbox so its
      // fill-only rows land on top of any preview-only gap fills.
      for (const { key, peer } of await listConvBlobKeys(pubkey)) {
        if (!peer) continue; // malformed key — delete-only
        const raw = await AsyncStorage.getItem(key).catch(() => null);
        const rows: DmMessageRow[] = [];
        for (const entry of safeParseArray<ConversationMessage>(raw)) {
          const row = convEntryToRow(pubkey, peer, entry);
          if (row) rows.push(row);
          else dropped++;
        }
        if (rows.length > 0) await importDmMessages(rows);
        imported += rows.length;
      }
      console.log(
        `[DmStore] blob migration: imported ${imported} inbox/conversation entries into the` +
          ` encrypted DB (dropped ${dropped} malformed) for ${pubkey.slice(0, 8)}`,
      );
      return { completed: true };
    },
    deletePlaintextCaches: async () => {
      const keys = [inboxCacheKey(pubkey), ...(await listConvBlobKeys(pubkey)).map((c) => c.key)];
      // Individual removes (not multiRemove) so one failure doesn't abort the
      // rest; the verify step catches anything that survived.
      for (const key of keys) await AsyncStorage.removeItem(key).catch(() => {});
      await deleteUnsuffixedWrapCaches(); // N9
    },
    verifyPlaintextGone: async () => {
      if ((await AsyncStorage.getItem(inboxCacheKey(pubkey)).catch(() => 'unreadable')) != null) {
        return false;
      }
      if ((await listConvBlobKeys(pubkey)).length > 0) return false;
      return unsuffixedWrapCachesGone();
    },
    warn: (msg) => console.warn(`[DmStore] ${msg}`),
  });
  if (result.ok && result.status === 'migrated') {
    console.log(
      `[DmStore] blob migration complete for ${pubkey.slice(0, 8)}: plaintext inbox/conversation` +
        ` blobs deleted (verified)`,
    );
  }
  return result.ok;
}
