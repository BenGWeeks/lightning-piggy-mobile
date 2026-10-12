import { decryptKind4WithSigner } from './kind4SignerDecrypt';
import { isTransientKind4Error } from './kind4RetryStore';
import { SignerUnavailableError } from '../services/signerErrors';
import { getMemoisedSecretKey } from './nostrSecretKeyCache';
import { decryptNip04WithSecret } from '../services/nostrService';

jest.mock('./nostrSecretKeyCache', () => ({ getMemoisedSecretKey: jest.fn() }));
jest.mock('../services/nostrService', () => ({ decryptNip04WithSecret: jest.fn() }));
jest.mock('../services/amberService', () => ({}));
jest.mock('./nip46DmDecrypt', () => ({}));

it('keeps missing local keys retryable but counts local ciphertext padding failures', async () => {
  jest.mocked(getMemoisedSecretKey).mockResolvedValueOnce(null);
  const missing = await decryptKind4WithSigner('owner', 'nsec', 'peer', 'cipher').catch((e) => e);
  expect(missing).toBeInstanceOf(SignerUnavailableError);
  expect(isTransientKind4Error(missing)).toBe(true);
  jest.mocked(getMemoisedSecretKey).mockResolvedValueOnce(new Uint8Array(32));
  // The actual noble AES implementation used by nostrService emits this text.
  jest.mocked(decryptNip04WithSecret).mockRejectedValueOnce(new Error('aes/pcks5: wrong padding'));
  const invalid = await decryptKind4WithSigner('owner', 'nsec', 'peer', 'cipher').catch((e) => e);
  expect(isTransientKind4Error(invalid)).toBe(false);
});
