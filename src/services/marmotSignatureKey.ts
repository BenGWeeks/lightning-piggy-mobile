// One leaf signing identity per account's installation slot (#1492).
// Only init/HPKE material rotates on KeyPackage refresh. Never log these keys.
import type { CiphersuiteImpl } from '@internet-privacy/marmot-ts/mls';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import * as SecureStore from 'expo-secure-store';

type SignatureKeyPair = Awaited<ReturnType<CiphersuiteImpl['signature']['keygen']>>;
const pending = new Map<string, Promise<unknown>>();
const slotKey = (owner: string) => `marmot_signature_slot_${owner}`;
const pairKey = (owner: string, slot: string) => `marmot_signature_key_${owner}_${slot}`;
const secureOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

/** Serialize first use, slot reset and sign-out; no late write can undo deletion. */
function serialized<T>(owner: string, task: () => Promise<T>): Promise<T> {
  const run = (pending.get(owner) ?? Promise.resolve()).catch(() => undefined).then(task);
  pending.set(owner, run);
  void run
    .finally(() => {
      if (pending.get(owner) === run) pending.delete(owner);
    })
    .catch(() => undefined);
  return run;
}

/** A changed slot removes its previous signing identity before creating another. */
export function getInstallationSignatureKeyPair(
  owner: string,
  slot: string,
  ciphersuite: CiphersuiteImpl,
): Promise<SignatureKeyPair> {
  return serialized(owner, async () => {
    const previous = await SecureStore.getItemAsync(slotKey(owner));
    if (previous && previous !== slot) {
      await SecureStore.deleteItemAsync(pairKey(owner, previous));
    }
    // Record the slot before the secret so a failed write can still be cleaned up.
    await SecureStore.setItemAsync(slotKey(owner), slot, secureOptions);
    const stored = await SecureStore.getItemAsync(pairKey(owner, slot));
    if (stored) {
      try {
        const value = JSON.parse(stored) as {
          publicKey: string;
          signKey: string;
          ciphersuite: number;
        };
        if (value.ciphersuite !== ciphersuite.id) throw new Error();
        return { publicKey: hexToBytes(value.publicKey), signKey: hexToBytes(value.signKey) };
      } catch {
        // JSON/hex parser errors can quote their input: keep the secret out of logs.
        throw new Error('Stored Marmot signing key is invalid for the ciphersuite');
      }
    }
    const pair = await ciphersuite.signature.keygen();
    await SecureStore.setItemAsync(
      pairKey(owner, slot),
      JSON.stringify({
        ciphersuite: ciphersuite.id,
        publicKey: bytesToHex(pair.publicKey),
        signKey: bytesToHex(pair.signKey),
      }),
      secureOptions,
    );
    return pair;
  });
}

/** Sign-out deletes the account's secret even if its SQL state cannot be opened. */
export function deleteInstallationSignatureKey(owner: string): Promise<void> {
  return serialized(owner, async () => {
    const slot = await SecureStore.getItemAsync(slotKey(owner));
    if (slot) await SecureStore.deleteItemAsync(pairKey(owner, slot));
    await SecureStore.deleteItemAsync(slotKey(owner));
  });
}
