// The public random slot id (kind-30443 `d`) belongs to the account's
// installation — a "device" in ideas/multi-device.md is one install signed in
// to one account — not to the account's encrypted MLS partition (which
// sign-out wipes). It is keyed by owner: two accounts on one phone must not
// share a `d`, or relays could link them. Never store private keys here.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { bytesToHex, randomBytes } from '@noble/hashes/utils.js';

import type { MarmotKvBackend } from './marmotStore';

const installationSlotKey = (owner: string) => `marmot_installation_slot_v1_${owner}`;
const VALID_SLOT = /^[0-9a-f]{64}$/;
const pending = new Map<string, Promise<string>>();

/** Test backends model separate installations; production persists outside account wipes. */
export async function ensureKeyPackageSlot(
  backend: MarmotKvBackend,
  owner: string,
  installationBackend?: MarmotKvBackend,
): Promise<string> {
  const get = () =>
    installationBackend
      ? installationBackend.get('installation', 'keyPackageSlot')
      : AsyncStorage.getItem(installationSlotKey(owner));
  const set = (slot: string) =>
    installationBackend
      ? installationBackend.set('installation', 'keyPackageSlot', slot)
      : AsyncStorage.setItem(installationSlotKey(owner), slot);
  const resolve = async () => {
    const stored = await get();
    if (stored && VALID_SLOT.test(stored)) return stored;
    // Preserve an existing install's current slot on upgrade.
    const legacy = await backend.get('meta', 'keyPackageSlot');
    const slot = legacy && VALID_SLOT.test(legacy) ? legacy : bytesToHex(randomBytes(32));
    await set(slot);
    return slot;
  };
  // Concurrent callers for one account (signing-key lookup, maintenance,
  // an overlapping account transition) must agree: the first chooses.
  let slot: string;
  if (installationBackend) slot = await resolve();
  else {
    const inFlight =
      pending.get(owner) ??
      resolve().finally(() => {
        pending.delete(owner);
      });
    pending.set(owner, inFlight);
    slot = await inFlight;
  }
  await backend.set('meta', 'keyPackageSlot', slot);
  return slot;
}

/** Public timestamps survive sign-out too: a new key must supersede the retirement tombstone. */
export async function keyPackageSlotTimestamp(owner: string, slot: string): Promise<number> {
  return Number(await AsyncStorage.getItem(`marmot_slot_timestamp_${owner}_${slot}`)) || 0;
}

export async function rememberKeyPackageTimestamp(event: {
  kind: number;
  pubkey: string;
  created_at: number;
  tags: string[][];
}): Promise<void> {
  const slot = event.tags.find((t) => t[0] === 'd')?.[1];
  if (event.kind !== 30443 || !slot) return;
  const key = `marmot_slot_timestamp_${event.pubkey}_${slot}`;
  const previous = await keyPackageSlotTimestamp(event.pubkey, slot);
  if (event.created_at > previous) await AsyncStorage.setItem(key, String(event.created_at));
}
