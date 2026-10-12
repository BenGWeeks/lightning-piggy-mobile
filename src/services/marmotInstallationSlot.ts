// Public random slot identity belongs to the installation, not the account's
// encrypted MLS partition (which sign-out wipes). Never store private keys here.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { bytesToHex, randomBytes } from '@noble/hashes/utils.js';

import type { MarmotKvBackend } from './marmotStore';

const INSTALLATION_SLOT_KEY = 'marmot_installation_slot_v1';
const VALID_SLOT = /^[0-9a-f]{64}$/;
let pending: Promise<string> | undefined;

/** Test backends model separate installations; production persists outside account wipes. */
export async function ensureKeyPackageSlot(
  backend: MarmotKvBackend,
  installationBackend?: MarmotKvBackend,
): Promise<string> {
  const get = () =>
    installationBackend
      ? installationBackend.get('installation', 'keyPackageSlot')
      : AsyncStorage.getItem(INSTALLATION_SLOT_KEY);
  const set = (slot: string) =>
    installationBackend
      ? installationBackend.set('installation', 'keyPackageSlot', slot)
      : AsyncStorage.setItem(INSTALLATION_SLOT_KEY, slot);
  const resolve = async () => {
    const stored = await get();
    if (stored && VALID_SLOT.test(stored)) return stored;
    // Preserve an existing install's current slot on upgrade.
    const legacy = await backend.get('meta', 'keyPackageSlot');
    const slot = legacy && VALID_SLOT.test(legacy) ? legacy : bytesToHex(randomBytes(32));
    await set(slot);
    return slot;
  };
  // Account transitions can overlap; the production installation chooses once.
  const slot = installationBackend
    ? await resolve()
    : await (pending ??= resolve().finally(() => {
        pending = undefined;
      }));
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
