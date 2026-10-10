import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import { authenticateForKeyReveal, keyRevealGate, loadAccountNsec } from './accountKeyAccess';
import { loadIdentities } from './identitiesStore';

jest.mock('./identitiesStore', () => ({ loadIdentities: jest.fn() }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn() }));
jest.mock('expo-local-authentication', () => ({
  SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
  getEnrolledLevelAsync: jest.fn(),
  authenticateAsync: jest.fn(),
}));

const BIG = 'a'.repeat(64);
const MIDDLE = 'b'.repeat(64);
const mockLoad = loadIdentities as jest.Mock;
const mockGet = SecureStore.getItemAsync as jest.Mock;
const mockLevel = LocalAuthentication.getEnrolledLevelAsync as jest.Mock;
const mockAuth = LocalAuthentication.authenticateAsync as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('loadAccountNsec', () => {
  it('returns the registry nsec for an nsec account', async () => {
    mockLoad.mockResolvedValue({
      identities: [{ pubkey: BIG, signerType: 'nsec', nsec: 'nsec1big', lastUsedAt: 1 }],
      activePubkey: BIG,
    });
    expect(await loadAccountNsec(BIG)).toBe('nsec1big');
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('returns null for an Amber account', async () => {
    mockLoad.mockResolvedValue({
      identities: [{ pubkey: MIDDLE, signerType: 'amber', lastUsedAt: 1 }],
      activePubkey: MIDDLE,
    });
    expect(await loadAccountNsec(MIDDLE)).toBeNull();
  });

  it('falls back to the legacy slot only when it belongs to the same pubkey', async () => {
    mockLoad.mockResolvedValue({ identities: [], activePubkey: null });
    mockGet.mockImplementation(async (k: string) =>
      k === 'nostr_pubkey' ? BIG : k === 'nostr_nsec' ? 'nsec1legacy' : null,
    );
    expect(await loadAccountNsec(BIG)).toBe('nsec1legacy');
    expect(await loadAccountNsec(MIDDLE)).toBeNull();
  });
});

describe('keyRevealGate', () => {
  it('uses device auth when a screen lock or biometrics is enrolled', async () => {
    mockLevel.mockResolvedValue(1);
    expect(await keyRevealGate()).toBe('device-auth');
  });

  it('falls back to an explicit confirmation with no screen lock', async () => {
    mockLevel.mockResolvedValue(0);
    expect(await keyRevealGate()).toBe('confirm-only');
    mockLevel.mockRejectedValue(new Error('no module'));
    expect(await keyRevealGate()).toBe('confirm-only');
  });
});

describe('authenticateForKeyReveal', () => {
  it('allows the device PIN fallback and reports success', async () => {
    mockAuth.mockResolvedValue({ success: true });
    expect(await authenticateForKeyReveal({ promptMessage: 'p', cancelLabel: 'c' })).toBe(true);
    expect(mockAuth).toHaveBeenCalledWith(
      expect.objectContaining({ disableDeviceFallback: false, promptMessage: 'p' }),
    );
  });

  it('reports failure on cancel or error', async () => {
    mockAuth.mockResolvedValue({ success: false, error: 'user_cancel' });
    expect(await authenticateForKeyReveal({ promptMessage: 'p', cancelLabel: 'c' })).toBe(false);
    mockAuth.mockRejectedValue(new Error('x'));
    expect(await authenticateForKeyReveal({ promptMessage: 'p', cancelLabel: 'c' })).toBe(false);
  });
});
