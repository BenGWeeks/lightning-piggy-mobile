import * as SecureStore from 'expo-secure-store';
import { decodeLivePingPayload, type LivePingPayload } from './liveLocationService';
import { decodeNsec, decryptNip04WithSecret } from './nostrService';
import * as amberService from './amberService';
import * as nostrConnectService from './nostrConnectService';

// Receive-side decrypt for kind-20069 live-location pings (#206). Shared by
// the per-conversation viewer (useConversationLiveLocation) and the
// all-friends Full Map layer (useFriendsLiveLocations) so the signer-aware
// NIP-04 decrypt + range-validated decode lives in exactly one place.

/**
 * Decrypt + decode an inbound live-location ping's ciphertext with whichever
 * signer is active. Amber goes through the platform IPC; nsec uses the local
 * secret. Returns `null` (never throws) for an unknown signer, a missing
 * secret, a decrypt failure, or a malformed payload — a single bad ping must
 * not tear down the viewer.
 */
export async function decryptIncomingLivePing(input: {
  signerType: string | null;
  content: string;
  senderPubkey: string;
  viewerPubkey: string;
}): Promise<LivePingPayload | null> {
  let plaintext: string | null = null;
  try {
    if (input.signerType === 'nsec') {
      const nsec = await SecureStore.getItemAsync('nostr_nsec');
      if (!nsec) return null;
      const { secretKey } = decodeNsec(nsec);
      plaintext = await decryptNip04WithSecret(secretKey, input.senderPubkey, input.content);
    } else if (input.signerType === 'amber') {
      plaintext = await amberService.requestNip04Decrypt(
        input.content,
        input.senderPubkey,
        input.viewerPubkey,
      );
    } else if (input.signerType === 'nip46') {
      plaintext = await nostrConnectService.requestNip04Decrypt(
        input.content,
        input.senderPubkey,
        input.viewerPubkey,
      );
    }
  } catch {
    return null;
  }
  if (!plaintext) return null;
  return decodeLivePingPayload(plaintext);
}
