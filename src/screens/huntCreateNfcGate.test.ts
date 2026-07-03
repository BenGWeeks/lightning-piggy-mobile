import { canWriteHuntTag } from './huntCreateNfcGate';

const PUBKEY = 'a'.repeat(64);

describe('canWriteHuntTag', () => {
  it('allows the write when a reward LNURL is present (private, no pubkey)', () => {
    expect(canWriteHuntTag({ lnurl: 'lnurl1abc', isPublic: false, pubkey: null })).toBe(true);
  });

  it('allows a no-prize public cache to write with an empty LNURL (#954/#955)', () => {
    // The regression this PR fixes: publishing was made optional, but the
    // NFC gate still required an LNURL. A public cache with the hider's
    // pubkey writes the 2-record hunt payload, no LNURL needed.
    expect(canWriteHuntTag({ lnurl: '', isPublic: true, pubkey: PUBKEY })).toBe(true);
    expect(canWriteHuntTag({ lnurl: '   ', isPublic: true, pubkey: PUBKEY })).toBe(true);
  });

  it('blocks a public cache with no LNURL when the hider is not logged in', () => {
    // No pubkey means no naddr, so the 2-record payload cannot be built.
    expect(canWriteHuntTag({ lnurl: '', isPublic: true, pubkey: null })).toBe(false);
    expect(canWriteHuntTag({ lnurl: '', isPublic: true, pubkey: undefined })).toBe(false);
  });

  it('blocks a private, no-LNURL listing (single-record path needs an LNURL)', () => {
    expect(canWriteHuntTag({ lnurl: '', isPublic: false, pubkey: PUBKEY })).toBe(false);
    expect(canWriteHuntTag({ lnurl: '   ', isPublic: false, pubkey: null })).toBe(false);
  });

  it('allows a public cache that also has an LNURL (reward + 2-record payload)', () => {
    expect(canWriteHuntTag({ lnurl: 'lnurl1abc', isPublic: true, pubkey: PUBKEY })).toBe(true);
  });
});
