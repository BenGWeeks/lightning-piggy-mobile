import {
  NWC_SHARE_KIND,
  isNwcConnectionUrl,
  serializeNwcShare,
  parseNwcShare,
  nwcSharePreviewText,
  nwcSharePreviewFromContent,
  nwcShareCardFromWallet,
  type NwcShareCard,
} from './nwcShareMessage';
import { dmRowPreview } from './dmRowPreview';

// A well-formed NWC connection string (fake pubkey/secret, real shape). The
// host is exactly 64 hex chars (a repeated 8-char block) as NIP-47 requires.
const VALID_NWC =
  'nostr+walletconnect://b0e2c8f9b0e2c8f9b0e2c8f9b0e2c8f9b0e2c8f9b0e2c8f9b0e2c8f9b0e2c8f9' +
  '?relay=wss%3A%2F%2Frelay.example.com&secret=abcdef0123456789abcdef0123456789';

describe('isNwcConnectionUrl', () => {
  it('accepts a well-formed NWC URL', () => {
    expect(isNwcConnectionUrl(VALID_NWC)).toBe(true);
    expect(isNwcConnectionUrl(`  ${VALID_NWC}  `)).toBe(true);
  });

  it('rejects the wrong protocol', () => {
    expect(isNwcConnectionUrl('https://example.com?relay=wss://r&secret=x')).toBe(false);
  });

  it('rejects a non-64-hex pubkey host', () => {
    expect(isNwcConnectionUrl('nostr+walletconnect://nothex?relay=wss%3A%2F%2Fr&secret=x')).toBe(
      false,
    );
  });

  it('rejects a missing relay or secret', () => {
    const host = 'b0e2c8f9b0e2c8f9b0e2c8f9b0e2c8f9b0e2c8f9b0e2c8f9b0e2c8f9b0e2c8f9';
    expect(isNwcConnectionUrl(`nostr+walletconnect://${host}?secret=x`)).toBe(false);
    expect(isNwcConnectionUrl(`nostr+walletconnect://${host}?relay=wss%3A%2F%2Fr`)).toBe(false);
  });

  it('rejects garbage / non-strings', () => {
    expect(isNwcConnectionUrl('not a url')).toBe(false);
    expect(isNwcConnectionUrl('')).toBe(false);
    // @ts-expect-error runtime guard for non-string input
    expect(isNwcConnectionUrl(undefined)).toBe(false);
  });
});

describe('serializeNwcShare / parseNwcShare round-trip', () => {
  it('round-trips with a wallet name', () => {
    const card: NwcShareCard = { nwcUrl: VALID_NWC, walletName: 'Pocket money' };
    expect(parseNwcShare(serializeNwcShare(card))).toEqual(card);
  });

  it('round-trips without a wallet name (blank name dropped)', () => {
    expect(parseNwcShare(serializeNwcShare({ nwcUrl: VALID_NWC, walletName: '   ' }))).toEqual({
      nwcUrl: VALID_NWC,
      walletName: undefined,
    });
  });

  it('rejects non-JSON, non-object, or a bad/missing URL', () => {
    expect(parseNwcShare('not json')).toBeNull();
    expect(parseNwcShare('"a string"')).toBeNull();
    expect(parseNwcShare(JSON.stringify({ walletName: 'x' }))).toBeNull();
    expect(parseNwcShare(JSON.stringify({ nwcUrl: 'https://nope.com' }))).toBeNull();
  });
});

describe('nwcShareCardFromWallet', () => {
  it('prefers the local alias for the card name', () => {
    expect(nwcShareCardFromWallet(VALID_NWC, 'Pocket money', 'CoinOS wallet')).toEqual({
      nwcUrl: VALID_NWC,
      walletName: 'Pocket money',
    });
  });

  it('falls back to the getInfo walletAlias when the local alias is blank', () => {
    expect(nwcShareCardFromWallet(VALID_NWC, '   ', 'CoinOS wallet')).toEqual({
      nwcUrl: VALID_NWC,
      walletName: 'CoinOS wallet',
    });
  });

  it('yields an unnamed card when neither name is set', () => {
    expect(nwcShareCardFromWallet(VALID_NWC, '   ', undefined)).toEqual({
      nwcUrl: VALID_NWC,
      walletName: undefined,
    });
    expect(nwcShareCardFromWallet(VALID_NWC, '', '  ')).toEqual({
      nwcUrl: VALID_NWC,
      walletName: undefined,
    });
  });
});

describe('previews never leak the bearer secret', () => {
  const card: NwcShareCard = { nwcUrl: VALID_NWC, walletName: 'Pocket money' };
  const content = serializeNwcShare(card);

  it('nwcSharePreviewText names the wallet without the URL', () => {
    const preview = nwcSharePreviewText(card);
    expect(preview).toContain('Pocket money');
    expect(preview).not.toContain('nostr+walletconnect');
    expect(preview).not.toContain('secret');
  });

  it('nwcSharePreviewFromContent redacts the connection string', () => {
    const preview = nwcSharePreviewFromContent(content);
    expect(preview).not.toContain('nostr+walletconnect');
    expect(preview).not.toContain('abcdef0123456789');
  });

  it('falls back to a neutral label with no wallet name / on a corrupt row', () => {
    expect(nwcSharePreviewText(null)).not.toContain('nostr+walletconnect');
    expect(nwcSharePreviewFromContent('garbage')).not.toContain('nostr+walletconnect');
  });

  it('dmRowPreview redacts an NWC-share row but passes plain text through', () => {
    const preview = dmRowPreview(content, NWC_SHARE_KIND);
    expect(preview).not.toContain('nostr+walletconnect');
    // A plain chat row (no special wireKind) is returned verbatim.
    expect(dmRowPreview('hello there', 14)).toBe('hello there');
  });

  it('dmRowPreview redacts a kind-15 encrypted-file row so the AES key never leaks', () => {
    // An AES-GCM voice note / photo is stored as its `#lpe=1…` URL, whose
    // fragment embeds the decryption key + nonce. The inbox/notification
    // preview must never carry it.
    const encryptedFileUrl = `https://blob.example/x.bin#lpe=1&k=${'a'.repeat(64)}&n=${'b'.repeat(24)}&m=audio%2Fmp4`;
    const preview = dmRowPreview(encryptedFileUrl, 15);
    expect(preview).not.toContain('lpe=');
    expect(preview).not.toContain('a'.repeat(64));
    expect(preview).not.toContain('blob.example');
    // A plain kind-15 row (bare blob URL, no `#lpe=1` secret) is not redacted.
    expect(dmRowPreview('https://blob.example/x.bin', 15)).toBe('https://blob.example/x.bin');
  });
});
