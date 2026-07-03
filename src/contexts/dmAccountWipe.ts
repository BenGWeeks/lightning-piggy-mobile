import { File, Paths } from 'expo-file-system';
import { deleteDmMessagesForOwner } from '../services/dmDb';
import { perAccountKey } from '../services/perAccountStorage';
import {
  AMBER_NIP17_CACHE_KEY_BASE,
  NSEC_NIP17_CACHE_KEY_BASE,
  AMBER_NIP17_SKIP_KEY_BASE,
  NSEC_NIP17_SKIP_KEY_BASE,
  NIP46_NIP17_SKIP_KEY_BASE,
  wrapCacheFileName,
} from './nostrDmCache';
import { forgetDmStoreMigration, pendingDmStoreMigration } from './dmStoreMigrationRunner';

/**
 * Per-account DM-store wipe, called from NostrContext's `wipeAccountCaches`
 * on sign-out / identity removal. Decrypted DM content must not survive a
 * wipe (#689 review / #690):
 *
 *  - the file-backed NIP-17 wrap caches (legacy pre-#848 installs that
 *    haven't migrated yet) and the #743/#746 skip-set files — the skip-set
 *    holds only wrap ids, but leaving it would leak across account switches
 *    and silently suppress wraps for the next signed-in user;
 *  - this owner's rows in the encrypted DB (#848). Best-effort like the file
 *    deletes — a DB-open failure must not wedge the logout flow, and the rows
 *    are SQLCipher-encrypted at rest regardless. When the LAST identity signs
 *    out, NostrContext additionally deletes the DB file + keystore key via
 *    `wipeLocalDmStore`;
 *  - the in-session migration memo, so a re-login re-checks the per-account
 *    flag (NostrContext removes the AsyncStorage flag itself).
 */
export async function wipeDmStoresForAccount(pubkey: string): Promise<void> {
  for (const base of [
    AMBER_NIP17_CACHE_KEY_BASE,
    NSEC_NIP17_CACHE_KEY_BASE,
    AMBER_NIP17_SKIP_KEY_BASE,
    NSEC_NIP17_SKIP_KEY_BASE,
    NIP46_NIP17_SKIP_KEY_BASE,
  ]) {
    try {
      const f = new File(Paths.document, wrapCacheFileName(perAccountKey(base, pubkey)));
      if (f.exists) f.delete();
    } catch {
      // best-effort — non-fatal
    }
  }
  // Await any in-flight migration first — wiping under it would let a late
  // upsert resurrect rows and re-set the migration flag after removal (N4).
  await pendingDmStoreMigration(pubkey)?.catch(() => {});
  try {
    await deleteDmMessagesForOwner(pubkey);
  } catch (e) {
    if (__DEV__) console.warn('[DmStore] per-owner DB wipe failed:', e);
  }
  forgetDmStoreMigration(pubkey);
}
