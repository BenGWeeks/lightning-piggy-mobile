import { defaultKeyPackageEqualityConfig } from '@internet-privacy/marmot-ts/mls';

import { installMarmotSameClientRule, isSameMarmotClient } from './marmotSameClient';

type Args = Parameters<typeof isSameMarmotClient>;
const account = new Uint8Array([1, 2, 3]); // stands in for the Nostr-pubkey credential
const keyPackage = (sig: number[]) =>
  ({
    leafNode: { signaturePublicKey: new Uint8Array(sig), credential: account },
  }) as unknown as Args[0];
const leaf = (sig: number[]) =>
  ({ signaturePublicKey: new Uint8Array(sig), credential: account }) as unknown as Args[1];

describe('Marmot "same client" rule (#1559)', () => {
  it('is the same leaf signing key, not merely the same account', () => {
    expect(isSameMarmotClient(keyPackage([9, 9]), leaf([9, 9]))).toBe(true);
    // Same account, another install: a new device, not a duplicate.
    expect(isSameMarmotClient(keyPackage([9, 9]), leaf([8, 8]))).toBe(false);
    expect(isSameMarmotClient(keyPackage([9]), leaf([9, 9]))).toBe(false);
  });

  it('replaces the library default MLS checks both commits against', () => {
    installMarmotSameClientRule();
    expect(defaultKeyPackageEqualityConfig.compareKeyPackageToLeafNode).toBe(isSameMarmotClient);
  });
});
