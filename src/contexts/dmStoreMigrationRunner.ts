import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import { migrateDmStore } from '../services/dmStoreMigration';
import { upsertDmMessages, type DmMessageRow } from '../services/dmDb';
import { perAccountKey } from '../services/perAccountStorage';
import {
  AMBER_NIP17_CACHE_KEY_BASE,
  NSEC_NIP17_CACHE_KEY_BASE,
  type Nip17CacheEntry,
  safeParseRecord,
  safeGetDmCacheItem,
  wrapCacheFileName,
} from './nostrDmCache';

// Per-account trigger for the one-time plaintext→encrypted DM-store migration
// (#848). The old wrap-cache file (#689) memoised every decrypt the inbox ever
// paid for; importing it as rows preserves that memo — migration day costs one
// file read + one DB transaction, NOT a full re-decrypt sweep (which is what
// #846/#847 just eliminated). Then the plaintext file is deleted with
// verification (dmStoreMigration's strict ordering). Both signer caches are
// imported — their entry shape is shared (nostrDmCache).
//
// Called from every DM entry point (inbox refresh, thread open, live-sub
// open): single-flighted per account, and a completed run memoises so later
// calls cost one Map lookup.

const MIGRATED_FLAG_PREFIX = 'dm_store_migrated_v1_';
export const dmStoreMigratedKey = (pubkey: string): string => MIGRATED_FLAG_PREFIX + pubkey;

const WRAP_CACHE_BASES = [NSEC_NIP17_CACHE_KEY_BASE, AMBER_NIP17_CACHE_KEY_BASE] as const;

const HEX_64 = /^[0-9a-f]{64}$/;

/** A wrap-cache entry → encrypted-store row, or null if the entry is too
 * malformed to import (corrupt cache survives as a no-op, not a crash). */
export function wrapCacheEntryToRow(owner: string, e: Nip17CacheEntry): DmMessageRow | null {
  const eventId = e.wrapId ?? e.id;
  if (typeof eventId !== 'string' || eventId.length === 0) return null;
  if (typeof e.partnerPubkey !== 'string' || !HEX_64.test(e.partnerPubkey)) return null;
  if (typeof e.text !== 'string' || !Number.isFinite(e.createdAt)) return null;
  return {
    owner,
    eventId,
    conversation: e.partnerPubkey,
    createdAt: e.createdAt,
    sender: e.fromMe ? owner : e.partnerPubkey,
    content: e.text,
    fromMe: e.fromMe === true,
    wireKind: typeof e.wireKind === 'number' ? e.wireKind : 14,
  };
}

async function runMigration(pubkey: string): Promise<boolean> {
  const result = await migrateDmStore({
    isMigrated: async () => (await AsyncStorage.getItem(dmStoreMigratedKey(pubkey))) === '1',
    setMigrated: async () => {
      await AsyncStorage.setItem(dmStoreMigratedKey(pubkey), '1');
    },
    populateEncryptedDb: async () => {
      let imported = 0;
      let dropped = 0;
      for (const base of WRAP_CACHE_BASES) {
        // safeGetDmCacheItem also hoists any legacy AsyncStorage row into the
        // file (#689) — deletePlaintextCaches below removes both regardless.
        const raw = await safeGetDmCacheItem(perAccountKey(base, pubkey));
        const cache = safeParseRecord<Nip17CacheEntry>(raw);
        const rows: DmMessageRow[] = [];
        for (const entry of Object.values(cache)) {
          const row = wrapCacheEntryToRow(pubkey, entry);
          if (row) rows.push(row);
          else dropped++;
        }
        if (rows.length > 0) await upsertDmMessages(rows);
        imported += rows.length;
      }
      console.log(
        `[DmStore] migration: imported ${imported} wrap-cache entries into the encrypted DB` +
          ` (dropped ${dropped} malformed) for ${pubkey.slice(0, 8)}`,
      );
      return { completed: true };
    },
    deletePlaintextCaches: async () => {
      for (const base of WRAP_CACHE_BASES) {
        const storageKey = perAccountKey(base, pubkey);
        // File-backed cache (#689) — the plaintext at issue.
        const f = new File(Paths.document, wrapCacheFileName(storageKey));
        if (f.exists) f.delete();
        // Pre-#689 legacy AsyncStorage row, if one survived.
        await AsyncStorage.removeItem(storageKey).catch(() => {});
      }
    },
    verifyPlaintextGone: async () => {
      for (const base of WRAP_CACHE_BASES) {
        const storageKey = perAccountKey(base, pubkey);
        try {
          if (new File(Paths.document, wrapCacheFileName(storageKey)).exists) return false;
        } catch {
          return false; // can't prove it's gone → treat as still present
        }
        if ((await AsyncStorage.getItem(storageKey).catch(() => null)) != null) return false;
      }
      return true;
    },
    warn: (msg) => console.warn(`[DmStore] ${msg}`),
  });
  if (result.ok && result.status === 'migrated') {
    console.log(
      `[DmStore] migration complete for ${pubkey.slice(0, 8)}: plaintext wrap cache deleted (verified)`,
    );
  }
  return result.ok;
}

// Single-flight + success memo per account. A failed/incomplete run clears
// its entry so the next DM entry point retries; a successful run stays
// memoised for the session (the AsyncStorage flag covers later sessions).
const migrationRuns = new Map<string, Promise<void>>();

/**
 * Ensure the one-time DM-store migration has run for `pubkey`. Never rejects
 * — a failure is logged and retried on the next call, so callers can fire it
 * inline on hot paths (inbox refresh / thread open / live-sub open).
 */
export function ensureDmStoreMigrated(pubkey: string): Promise<void> {
  const existing = migrationRuns.get(pubkey);
  if (existing) return existing;
  const run = runMigration(pubkey)
    .then((ok) => {
      if (!ok) migrationRuns.delete(pubkey);
    })
    .catch((e) => {
      migrationRuns.delete(pubkey);
      if (__DEV__) console.warn('[DmStore] migration failed (will retry):', e);
    });
  migrationRuns.set(pubkey, run);
  return run;
}

/** Drop the in-session memo (logout / account wipe) so a re-login re-checks
 * the per-account flag instead of trusting a stale "done" from this session. */
export function forgetDmStoreMigration(pubkey: string): void {
  migrationRuns.delete(pubkey);
}

/** The in-flight migration for `pubkey`, if any — so a logout wipe can await
 * it instead of racing it (a late upsert would resurrect just-wiped rows and
 * re-set the just-removed flag; Archie review N4 on #849). */
export function pendingDmStoreMigration(pubkey: string): Promise<void> | undefined {
  return migrationRuns.get(pubkey);
}
