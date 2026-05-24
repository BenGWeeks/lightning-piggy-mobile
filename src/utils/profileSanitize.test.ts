/**
 * Guards the security invariant behind the kind-0 verification fast-path
 * (#526 / PR #539 Copilot review): a profile fetched via the unverified
 * batch path must never carry a payment-relevant `lud16` — a forged one
 * would silently redirect a zap. `slimDisplayProfile` is what enforces
 * that, so if a refactor regresses it this test fails loudly.
 */
import { slimDisplayProfile } from './profileSanitize';
import type { NostrProfile } from '../types/nostr';

const fullProfile: NostrProfile = {
  pubkey: 'a'.repeat(64),
  npub: 'npub1example',
  name: 'Alice',
  displayName: 'Alice A.',
  picture: 'https://example.com/alice.png',
  banner: 'https://example.com/banner.png',
  about: 'pizza enjoyer',
  lud16: 'alice@getalby.com',
  nip05: 'alice@example.com',
};

describe('slimDisplayProfile', () => {
  it('drops lud16 — the payment-redirect vector on an unverified profile', () => {
    expect(slimDisplayProfile(fullProfile).lud16).toBeNull();
  });

  it('keeps the banner (cosmetic) — the quick-profile sheet renders it (#666/#18)', () => {
    expect(slimDisplayProfile(fullProfile).banner).toBe('https://example.com/banner.png');
  });

  it('keeps about (cosmetic) so the bio isn’t empty on batch-fetched profiles', () => {
    expect(slimDisplayProfile(fullProfile).about).toBe('pizza enjoyer');
  });

  it('keeps the display fields the zap resolver and contacts list render', () => {
    const slim = slimDisplayProfile(fullProfile);
    expect(slim.pubkey).toBe(fullProfile.pubkey);
    expect(slim.npub).toBe(fullProfile.npub);
    expect(slim.name).toBe('Alice');
    expect(slim.displayName).toBe('Alice A.');
    expect(slim.picture).toBe('https://example.com/alice.png');
    expect(slim.nip05).toBe('alice@example.com');
  });

  it('does not mutate the input profile', () => {
    const input = { ...fullProfile };
    slimDisplayProfile(input);
    expect(input.lud16).toBe('alice@getalby.com');
    expect(input.banner).toBe('https://example.com/banner.png');
  });

  it('is idempotent — slimming an already-slim profile is a no-op', () => {
    const once = slimDisplayProfile(fullProfile);
    expect(slimDisplayProfile(once)).toEqual(once);
  });

  it('leaves already-null payment fields null (no crash on a sparse profile)', () => {
    const sparse: NostrProfile = {
      pubkey: 'b'.repeat(64),
      npub: 'npub1sparse',
      name: null,
      displayName: null,
      picture: null,
      banner: null,
      about: null,
      lud16: null,
      nip05: null,
    };
    expect(slimDisplayProfile(sparse)).toEqual(sparse);
  });
});
