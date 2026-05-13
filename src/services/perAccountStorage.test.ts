// Unit tests for the per-account key helper. Tiny but load-bearing —
// the rest of the multi-account refactor (#288) trusts this to produce
// the same suffix shape the migration writes to.

import { perAccountKey, PER_ACCOUNT_STORAGE_BASES } from './perAccountStorage';

describe('perAccountKey', () => {
  it('appends `_${pubkey}` for a real pubkey', () => {
    const pk = 'a'.repeat(64);
    expect(perAccountKey('nostr_groups', pk)).toBe(`nostr_groups_${pk}`);
  });

  it('returns the bare base key when pubkey is null', () => {
    expect(perAccountKey('nostr_groups', null)).toBe('nostr_groups');
  });

  it('returns the bare base key when pubkey is undefined', () => {
    expect(perAccountKey('nostr_groups', undefined)).toBe('nostr_groups');
  });

  it('returns the bare base key when pubkey is the empty string', () => {
    // Empty string is the "race during boot" case — the call site
    // shouldn't throw, just fall back to the legacy global slot.
    expect(perAccountKey('wallet_list', '')).toBe('wallet_list');
  });

  it('round-trips through every PER_ACCOUNT_STORAGE_BASES entry', () => {
    const pk = 'b'.repeat(64);
    for (const base of PER_ACCOUNT_STORAGE_BASES) {
      expect(perAccountKey(base, pk)).toBe(`${base}_${pk}`);
    }
  });
});
