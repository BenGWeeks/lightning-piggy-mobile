import AsyncStorage from '@react-native-async-storage/async-storage';
import * as nostrService from './nostrService';
import { perAccountKey } from './perAccountStorage';

/**
 * "This account was created in Lightning Piggy on this device" (#1271).
 *
 * Only such an account may treat "relays confirm there's no kind-3" as a
 * genuinely empty follow list and publish a fresh one. An imported or
 * signed-in key (nsec import, Amber, NIP-46) can have its real list on relays
 * we never query, so two of ours saying "none" proves nothing for it.
 *
 * Set at new-account onboarding; cleared as soon as any kind-3 for the account
 * has been seen or published, after which the normal fetch-and-merge path
 * always has a list to build on. It also expires on its own after
 * `CREATED_HERE_TTL_MS`, so even if storage refuses every attempt to revoke it,
 * the licence can't outlive the onboarding window.
 */
export const CREATED_HERE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CREATED_HERE_KEY_BASE = 'lp_account_created_here';
const flagKey = (pubkey: string) => perAccountKey(CREATED_HERE_KEY_BASE, pubkey.toLowerCase());

// Revocations take effect in memory immediately, so a write racing the
// storage update (or a storage failure) can't still see the flag this session.
const revoked = new Set<string>();

export async function markAccountCreatedHere(pubkey: string): Promise<void> {
  revoked.delete(pubkey.toLowerCase());
  await AsyncStorage.setItem(flagKey(pubkey), String(Date.now()));
}

export async function isAccountCreatedHere(pubkey: string): Promise<boolean> {
  if (revoked.has(pubkey.toLowerCase())) return false;
  try {
    const createdAt = Number(await AsyncStorage.getItem(flagKey(pubkey)));
    // Missing, revoked ('0') or garbage → NaN / 0 → false. Expired → false.
    return createdAt > 0 && Date.now() - createdAt < CREATED_HERE_TTL_MS;
  } catch {
    return false;
  }
}

/**
 * Revoke for good. Both removing the key and overwriting it with '0' are
 * attempted, so either succeeding is enough to survive a restart; if storage
 * refuses both, the in-memory revocation covers this session and the TTL
 * bounds the rest.
 */
export async function clearAccountCreatedHere(pubkey: string): Promise<void> {
  const pk = pubkey.toLowerCase();
  if (revoked.has(pk)) return; // already revoked (and persisted) this session
  revoked.add(pk);
  const key = flagKey(pubkey);
  await Promise.allSettled([AsyncStorage.setItem(key, '0'), AsyncStorage.removeItem(key)]);
}

/** Test-only: forget in-memory revocations, as an app restart would. */
export function __resetForTests(): void {
  revoked.clear();
}

/**
 * New-account onboarding: flag the account as created here, then publish an
 * empty kind-3 (our usual shape: client tag, empty content) so later follows
 * always find a list to build on. If that publish fails, the flag stays and
 * the first follow can still start a fresh list once relays confirm none.
 * Never call this for imported or signed-in keys.
 */
export async function setUpNewAccountContactList({
  pubkey,
  secretKey,
  relays,
  publish = nostrService.signAndPublishEvent,
}: {
  pubkey: string;
  secretKey: Uint8Array;
  relays: string[];
  publish?: typeof nostrService.signAndPublishEvent;
}): Promise<boolean> {
  await markAccountCreatedHere(pubkey);
  try {
    await publish(nostrService.createContactListEvent([]), secretKey, relays);
  } catch (e) {
    if (__DEV__) console.warn('[ContactList] initial empty kind-3 publish failed:', e);
    return false;
  }
  await clearAccountCreatedHere(pubkey);
  return true;
}
