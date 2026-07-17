/**
 * Platform-guard tests for modules/nostr-native/index.ts (Copilot #1054).
 *
 * Lives under src/ so jest.config's testMatch — the `.test.{ts,tsx}` files
 * under the `<rootDir>/src` tree — picks it
 * up — the module under test is in modules/nostr-native. It verifies
 * getNostrNative()'s hard platform allowlist (Android Kotlin since M1/M2,
 * iOS Swift since M3): even when requireOptionalNativeModule resolves to a
 * non-null module, the facade can NEVER route into it on an unsupported
 * platform — getNostrNative() returns null there.
 */

// Resolve the native module to a non-null stub so the ONLY thing that can make
// getNostrNative() return null is the platform guard, not module absence. The
// factory is self-contained (no out-of-scope refs) so it survives jest.mock
// hoisting above the ES imports below.
jest.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: () => ({
    warmUp: async () => true,
    nip44Encrypt: () => '',
    nip44Decrypt: () => '',
    schnorrSign: () => '',
    schnorrVerify: () => true,
  }),
}));

// Mutable Platform so each test can pick the OS (mirrors the repo pattern in
// backgroundDmService.test.ts). Platform.OS is read inside getNostrNative() at
// call time, so mutating it between tests changes the guard's verdict.
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

import { Platform } from 'react-native';

import { getNostrNative } from '../../modules/nostr-native';

function setOS(os: string): void {
  (Platform as unknown as { OS: string }).OS = os;
}

describe('getNostrNative platform guard', () => {
  it('returns the linked module on iOS (M3 bindings)', () => {
    setOS('ios');
    const mod = getNostrNative();
    expect(mod).not.toBeNull();
    expect(typeof mod?.schnorrVerify).toBe('function');
  });

  it('returns null on web', () => {
    setOS('web');
    expect(getNostrNative()).toBeNull();
  });

  it('returns the linked module on Android', () => {
    setOS('android');
    const mod = getNostrNative();
    expect(mod).not.toBeNull();
    expect(typeof mod?.schnorrVerify).toBe('function');
  });
});
