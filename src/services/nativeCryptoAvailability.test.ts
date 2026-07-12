/**
 * Platform-guard tests for the facade capability probe isNativeCryptoAvailable()
 * (#1057). It delegates to getNostrNative(), whose hard Platform.OS === 'android'
 * guard means the Settings toggle can only ever be enabled on Android with the
 * module linked — off-Android the row renders disabled ("Unavailable on this
 * device"). Mirrors nostrNativeModule.test.ts's mutable-Platform pattern.
 *
 * The native module is resolved to a non-null stub so the ONLY thing that can
 * make availability false here is the platform guard, not module absence
 * (module-absence is covered in nostrCryptoNative.test.ts, where getNostrNative
 * itself is mocked to null).
 */
jest.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: () => ({
    warmUp: async () => true,
    nip44Encrypt: () => '',
    nip44Decrypt: () => '',
    schnorrSign: () => '',
    schnorrVerify: () => true,
  }),
}));

// Mutable Platform — Platform.OS is read inside getNostrNative() at call time,
// so mutating it between tests changes the probe's verdict.
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

import { Platform } from 'react-native';

import { isNativeCryptoAvailable } from './nostrCrypto';

function setOS(os: string): void {
  (Platform as unknown as { OS: string }).OS = os;
}

describe('isNativeCryptoAvailable platform guard', () => {
  it('returns false on iOS even when the native module resolves', () => {
    setOS('ios');
    expect(isNativeCryptoAvailable()).toBe(false);
  });

  it('returns false on web', () => {
    setOS('web');
    expect(isNativeCryptoAvailable()).toBe(false);
  });

  it('returns true on Android when the module is linked', () => {
    setOS('android');
    expect(isNativeCryptoAvailable()).toBe(true);
  });
});
