/**
 * Unit tests for persistActiveIdentityKeys (#851) — the shared SecureStore
 * promotion used by switchIdentity and the logout-with-successor path. Pins
 * which legacy single-identity slots each signer kind writes, and the
 * `clearOtherSlot` difference between the two callers (switchIdentity clears
 * the stale opposite slot; the logout successor path does not).
 *
 * Also pins the hardened SecureStore write options (#876 Copilot review): the
 * nsec / persisted-identity slots must be written with
 * AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY so the secret isn't eligible for
 * iCloud/backup migration — matching identitiesStore / walletStorageService.
 */

const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY = 'after-first-unlock-this-device-only';
const mockSet = jest.fn(async (..._a: unknown[]) => {});
const mockDelete = jest.fn(async (..._a: unknown[]) => {});
jest.mock('expo-secure-store', () => ({
  setItemAsync: (...a: unknown[]) => mockSet(...a),
  deleteItemAsync: (...a: unknown[]) => mockDelete(...a),
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'after-first-unlock-this-device-only',
}));

import { persistActiveIdentityKeys } from './persistActiveIdentityKeys';
import { NSEC_KEY, PUBKEY_KEY, SIGNER_TYPE_KEY } from './nostrAuthKeys';

const PUBKEY = 'a'.repeat(64);
const NSEC = 'nsec1example';
const HARDENED = { keychainAccessible: AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

describe('persistActiveIdentityKeys', () => {
  beforeEach(() => jest.clearAllMocks());

  it('writes signer type + nsec for an nsec identity', async () => {
    await persistActiveIdentityKeys({ pubkey: PUBKEY, signerType: 'nsec', nsec: NSEC });
    expect(mockSet).toHaveBeenCalledWith(SIGNER_TYPE_KEY, 'nsec', HARDENED);
    expect(mockSet).toHaveBeenCalledWith(NSEC_KEY, NSEC, HARDENED);
    // Default: don't touch the amber slot.
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('writes signer type + pubkey for an amber identity', async () => {
    await persistActiveIdentityKeys({ pubkey: PUBKEY, signerType: 'amber' });
    expect(mockSet).toHaveBeenCalledWith(SIGNER_TYPE_KEY, 'amber', HARDENED);
    expect(mockSet).toHaveBeenCalledWith(PUBKEY_KEY, PUBKEY, HARDENED);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('writes every legacy slot with the hardened device-only keychain option', async () => {
    await persistActiveIdentityKeys({ pubkey: PUBKEY, signerType: 'nsec', nsec: NSEC });
    // No bare two-arg write may slip through — every call carries the options.
    for (const call of mockSet.mock.calls) {
      expect(call[2]).toEqual(HARDENED);
    }
  });

  it('clears the stale amber slot when promoting an nsec identity with clearOtherSlot', async () => {
    await persistActiveIdentityKeys(
      { pubkey: PUBKEY, signerType: 'nsec', nsec: NSEC },
      { clearOtherSlot: true },
    );
    expect(mockSet).toHaveBeenCalledWith(NSEC_KEY, NSEC, HARDENED);
    expect(mockDelete).toHaveBeenCalledWith(PUBKEY_KEY);
  });

  it('clears the stale nsec slot when promoting an amber identity with clearOtherSlot', async () => {
    await persistActiveIdentityKeys(
      { pubkey: PUBKEY, signerType: 'amber' },
      { clearOtherSlot: true },
    );
    expect(mockSet).toHaveBeenCalledWith(PUBKEY_KEY, PUBKEY, HARDENED);
    expect(mockDelete).toHaveBeenCalledWith(NSEC_KEY);
  });

  it('does not write the nsec slot when an nsec identity has no secret', async () => {
    await persistActiveIdentityKeys({ pubkey: PUBKEY, signerType: 'nsec' });
    expect(mockSet).toHaveBeenCalledWith(SIGNER_TYPE_KEY, 'nsec', HARDENED);
    expect(mockSet).not.toHaveBeenCalledWith(NSEC_KEY, expect.anything(), expect.anything());
  });
});
