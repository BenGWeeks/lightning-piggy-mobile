import * as SecureStore from 'expo-secure-store';
import { getPublicKey } from 'nostr-tools';
import { signAccountEvent } from './signAccountEvent';
import { signEvent } from './nostrService';
jest.mock('./nostrService', () => ({
  decodeNsec: () => ({ secretKey: new Uint8Array(32).fill(8) }),
  signEvent: jest.fn(),
}));
jest.mock('./amberService', () => ({ requestEventSignature: jest.fn() }));
jest.mock('../contexts/nip46DmDecrypt', () => ({ nip46Sign: jest.fn() }));
it('does not sign account A’s pending template with account B’s replacement stored key', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(SecureStore, 'getItemAsync').mockResolvedValue('replacement key');
  await expect(
    signAccountEvent(
      { kind: 30405, created_at: 100, tags: [], content: 'A shop' },
      {
        pubkey: getPublicKey(new Uint8Array(32).fill(7)),
        isLoggedIn: true,
        signerType: 'nsec',
      },
    ),
  ).resolves.toBeNull();
  expect(signEvent).not.toHaveBeenCalled();
  jest.restoreAllMocks();
});
