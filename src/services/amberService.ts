import { Platform } from 'react-native';
import * as nip19 from 'nostr-tools/nip19';
import * as AmberSigner from '../../modules/amber-signer';

export function isAmberSupported(): boolean {
  return Platform.OS === 'android';
}

export async function isAmberInstalled(): Promise<boolean> {
  if (!isAmberSupported()) return false;
  return AmberSigner.isInstalled();
}

export async function requestPublicKey(): Promise<string> {
  if (!isAmberSupported()) {
    throw new Error('Amber is only supported on Android');
  }
  const result = await AmberSigner.getPublicKey();
  let pk = result.pubkey;

  // Amber may return npub (bech32) instead of hex — convert if needed
  if (pk.startsWith('npub1')) {
    const decoded = nip19.decode(pk);
    if (decoded.type === 'npub') {
      pk = decoded.data;
    }
  }

  return pk;
}

export async function requestEventSignature(
  eventJson: string,
  eventId: string,
  currentUser: string,
): Promise<{ signature: string; event: string }> {
  if (!isAmberSupported()) {
    throw new Error('Amber is only supported on Android');
  }
  const result = await AmberSigner.signEvent(eventJson, eventId, currentUser);
  return { signature: result.signature, event: result.event };
}

export async function requestNip04Encrypt(
  plaintext: string,
  recipientPubkey: string,
  currentUser: string,
): Promise<string> {
  if (!isAmberSupported()) {
    throw new Error('Amber is only supported on Android');
  }
  const { result } = await AmberSigner.nip04Encrypt(plaintext, recipientPubkey, currentUser);
  return result;
}

export async function requestNip04Decrypt(
  ciphertext: string,
  senderPubkey: string,
  currentUser: string,
): Promise<string> {
  if (!isAmberSupported()) {
    throw new Error('Amber is only supported on Android');
  }
  const { result } = await AmberSigner.nip04Decrypt(ciphertext, senderPubkey, currentUser);
  return result;
}
