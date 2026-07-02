/**
 * wipeAccountCaches — delete every per-account persisted artifact for a
 * signed-out identity: per-wallet secrets (SecureStore), per-wallet tx
 * caches, the per-account namespaced caches from the #288 storage refactor,
 * per-conversation DM caches, and the encrypted DM store rows (#848).
 *
 * Extracted from NostrContext (#703 file-size effort) — it was a
 * zero-dependency useCallback (empty deps array) closing over no provider
 * state, so it's a pure module function. Called by logout and
 * signOutIdentity.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { perAccountKey } from '../services/perAccountStorage';
import { deleteNwcUrl, deleteXpub, deleteMnemonic } from '../services/walletStorageService';
import {
  AMBER_NIP17_CACHE_KEY_BASE,
  NSEC_NIP17_CACHE_KEY_BASE,
  DM_CONV_CACHE_PREFIX,
  DM_CONV_LAST_SEEN_PREFIX,
  inboxCacheKey,
  inboxLastSeenKey,
} from './nostrDmCache';
import { wipeDmStoresForAccount } from './dmAccountWipe';
import { dmStoreMigratedKey } from './dmStoreMigrationRunner';
import {
  CONTACTS_CACHE_KEY_BASE,
  PROFILES_CACHE_KEY_BASE,
  CACHE_TIMESTAMP_KEY_BASE,
  CONTACTS_TIMESTAMP_KEY_BASE,
  OWN_PROFILE_CACHE_KEY_BASE,
  OWN_PROFILE_TIMESTAMP_KEY_BASE,
  RELAY_LIST_CACHE_KEY_BASE,
  RELAY_LIST_TIMESTAMP_KEY_BASE,
} from './nostrCacheKeys';

export async function wipeAccountCaches(loggedOutPubkey: string | null): Promise<void> {
  if (!loggedOutPubkey) return;
  // Read the per-account wallet list FIRST so we can delete the
  // per-wallet secrets that live in SecureStore (NWC URLs, xpubs,
  // mnemonics) and the per-wallet AsyncStorage tx caches. Without
  // this, signing out of an identity leaves orphaned credentials
  // and tx caches under their walletIds — a real privacy concern
  // on shared devices and what Copilot flagged on #442.
  const walletListKey = `wallet_list_${loggedOutPubkey}`;
  let walletIds: string[] = [];
  try {
    const json = await AsyncStorage.getItem(walletListKey);
    if (json) {
      const list = JSON.parse(json) as Array<{ id: string }>;
      if (Array.isArray(list)) walletIds = list.map((w) => w.id).filter(Boolean);
    }
  } catch {
    // Corrupted wallet list — nothing we can clean per-wallet,
    // but the AsyncStorage.multiRemove below still kills the list
    // entry itself so a future load won't surface it.
  }
  // Per-wallet secret cleanup. Each delete is best-effort; an
  // already-absent key is a no-op in expo-secure-store, so we
  // can fan out concurrently without sequencing.
  await Promise.allSettled(
    walletIds.flatMap((id) => [deleteNwcUrl(id), deleteXpub(id), deleteMnemonic(id)]),
  );

  const toRemove: string[] = [
    // Per-account namespaced caches (#288 storage refactor)
    perAccountKey(CONTACTS_CACHE_KEY_BASE, loggedOutPubkey),
    perAccountKey(CONTACTS_TIMESTAMP_KEY_BASE, loggedOutPubkey),
    perAccountKey(PROFILES_CACHE_KEY_BASE, loggedOutPubkey),
    perAccountKey(CACHE_TIMESTAMP_KEY_BASE, loggedOutPubkey),
    perAccountKey(OWN_PROFILE_CACHE_KEY_BASE, loggedOutPubkey),
    perAccountKey(OWN_PROFILE_TIMESTAMP_KEY_BASE, loggedOutPubkey),
    perAccountKey(RELAY_LIST_CACHE_KEY_BASE, loggedOutPubkey),
    perAccountKey(RELAY_LIST_TIMESTAMP_KEY_BASE, loggedOutPubkey),
    perAccountKey(AMBER_NIP17_CACHE_KEY_BASE, loggedOutPubkey),
    perAccountKey(NSEC_NIP17_CACHE_KEY_BASE, loggedOutPubkey),
    // DM-store migration flag (#848) — a future re-login re-runs the
    // (then no-op) migration check instead of trusting a stale flag.
    dmStoreMigratedKey(loggedOutPubkey),
    // Pre-existing per-pubkey caches (already namespaced before #288)
    inboxCacheKey(loggedOutPubkey),
    inboxLastSeenKey(loggedOutPubkey),
    `nostr_group_activity_${loggedOutPubkey}`,
    `nostr_groups_${loggedOutPubkey}`,
    `groups_following_only_${loggedOutPubkey}`,
    walletListKey,
    // Per-wallet tx caches (AsyncStorage). One key per wallet that
    // was bound to this identity.
    ...walletIds.map((id) => `txs_${id}`),
  ];
  const allKeys = await AsyncStorage.getAllKeys();
  const convPrefix = DM_CONV_CACHE_PREFIX + loggedOutPubkey + '_';
  const lastSeenPrefix = DM_CONV_LAST_SEEN_PREFIX + loggedOutPubkey + '_';
  for (const k of allKeys) {
    if (k.startsWith(convPrefix) || k.startsWith(lastSeenPrefix)) toRemove.push(k);
  }
  // group_messages_${groupId} is keyed by the random group id (not
  // pubkey), so we can't selectively remove "this identity's groups"
  // — they're shared across whichever identities are members. Leave
  // them in place; they're orphaned safely once no remaining identity
  // is a member, and re-attached if the same identity signs back in.
  await AsyncStorage.multiRemove(toRemove);
  // Decrypted DM plaintext must not survive logout / account wipe (#689
  // review / #690): delete the file-backed wrap + skip-set caches and this
  // owner's rows in the encrypted DB (#848) — see dmAccountWipe.
  await wipeDmStoresForAccount(loggedOutPubkey);
}
