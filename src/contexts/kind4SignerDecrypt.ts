import { SignerUnavailableError } from '../services/signerErrors';
import type { SignerType } from '../types/nostr';
import * as nostrService from '../services/nostrService';
import * as amberService from '../services/amberService';
import { nip46DecryptNip04 } from './nip46DmDecrypt';
import { getMemoisedSecretKey } from './nostrSecretKeyCache';

/** Preserve signer errors for inbox retry classification. */
export async function decryptKind4WithSigner(
  owner: string | null,
  signer: SignerType | null,
  peer: string,
  ciphertext: string,
): Promise<string | null> {
  if (!owner) throw new SignerUnavailableError();
  if (signer === 'nsec') {
    const key = await getMemoisedSecretKey(owner);
    if (!key) throw new SignerUnavailableError();
    return nostrService.decryptNip04WithSecret(key, peer, ciphertext);
  }
  let text: string | null;
  if (signer === 'amber') text = await amberService.requestNip04Decrypt(ciphertext, peer, owner);
  else if (signer === 'nip46') text = await nip46DecryptNip04(ciphertext, peer, owner);
  else throw new SignerUnavailableError();
  if (text === null) throw new SignerUnavailableError('Signer temporarily unavailable');
  return text;
}
