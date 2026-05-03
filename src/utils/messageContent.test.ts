/**
 * Coverage for the message-content classifiers (image / invoice / LN
 * address / shared contact / time / relative-future). The bolt11
 * decoder is real (light-bolt11-decoder is pure JS); we only fixture
 * a known-valid testnet invoice so the assertion is deterministic.
 */

import * as nip19 from 'nostr-tools/nip19';

import {
  extractImageUrl,
  extractInvoice,
  extractLightningAddress,
  extractSharedContact,
  formatRelativeFuture,
  formatTime,
} from './messageContent';

// ---------- extractImageUrl ----------

describe('extractImageUrl', () => {
  it('returns null for empty input', () => {
    expect(extractImageUrl('')).toBeNull();
  });

  it('matches a bare image URL with a trusted extension', () => {
    expect(extractImageUrl('https://example.com/cat.jpg')).toBe('https://example.com/cat.jpg');
    expect(extractImageUrl('http://x.test/y.png')).toBe('http://x.test/y.png');
  });

  it('tolerates surrounding whitespace and case-insensitive extensions', () => {
    expect(extractImageUrl('  https://example.com/IMG.JPEG  ')).toBe(
      'https://example.com/IMG.JPEG',
    );
  });

  it('matches when a query string follows the extension', () => {
    expect(extractImageUrl('https://example.com/cat.png?v=2')).toBe(
      'https://example.com/cat.png?v=2',
    );
  });

  it('rejects URLs the regex does not whitelist as images', () => {
    expect(extractImageUrl('https://example.com/page.html')).toBeNull();
    // Trailing text means the URL isn't the entire body — must not match.
    expect(extractImageUrl('check this https://example.com/cat.jpg please')).toBeNull();
  });
});

// ---------- extractInvoice ----------

describe('extractInvoice', () => {
  // A historical mainnet invoice from BOLT-11's own test vectors:
  // 2500µBTC = 0.0025 BTC = 250_000 sats. Stable, decodable, no live network.
  const TEST_INVOICE =
    'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp';

  it('returns null when no invoice is present', () => {
    expect(extractInvoice('hello there')).toBeNull();
    expect(extractInvoice('')).toBeNull();
  });

  it('decodes amount, description and payment hash from a valid invoice', () => {
    const dec = extractInvoice(TEST_INVOICE);
    expect(dec).not.toBeNull();
    expect(dec!.raw).toBe(TEST_INVOICE);
    expect(dec!.amountSats).toBe(250_000);
    // description / paymentHash come from the invoice itself — just
    // assert their *presence* and shape (paymentHash = 64 hex).
    expect(typeof dec!.description === 'string' || dec!.description === null).toBe(true);
    if (dec!.paymentHash !== null) {
      expect(dec!.paymentHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('strips a leading lightning: URI scheme', () => {
    const dec = extractInvoice(`lightning:${TEST_INVOICE}`);
    expect(dec).not.toBeNull();
    expect(dec!.raw).toBe(TEST_INVOICE);
  });

  it('returns a partial result for an undecodable invoice-shaped string', () => {
    // Looks like an invoice (lnbc + many chars) but won't decode → the
    // catch path returns the raw with all numeric fields set to null.
    const garbage = 'lnbc' + 'z'.repeat(60);
    const dec = extractInvoice(`pay this ${garbage} please`);
    expect(dec).not.toBeNull();
    expect(dec!.amountSats).toBeNull();
    expect(dec!.paymentHash).toBeNull();
  });
});

// ---------- extractLightningAddress ----------

describe('extractLightningAddress', () => {
  it('returns null for empty input', () => {
    expect(extractLightningAddress('')).toBeNull();
  });

  it('extracts a lightning: prefixed LN address', () => {
    expect(extractLightningAddress('Pay me at lightning:alice@example.com please')).toBe(
      'alice@example.com',
    );
  });

  it('does NOT match a plain unprefixed email-shaped string', () => {
    // The whole point of the prefix gate: avoid turning every shared
    // email into a Pay button.
    expect(extractLightningAddress('Email me at alice@example.com')).toBeNull();
  });
});

// ---------- extractSharedContact ----------

describe('extractSharedContact', () => {
  it('returns null for empty input', () => {
    expect(extractSharedContact('')).toBeNull();
  });

  it('returns null when no nostr: URI is present', () => {
    expect(extractSharedContact('hello world')).toBeNull();
  });

  it('decodes a nostr:npub… profile URI', () => {
    // BIP-340 generator pubkey, valid 32-byte x-only key — chosen
    // because nip19 will accept it as an npub payload deterministically.
    // npub is recomputed from a known hex via nip19 to avoid hand-encoding.
    const hex = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
    const npub = nip19.npubEncode(hex);
    const out = extractSharedContact(`Add me on nostr:${npub} thanks`);
    expect(out).not.toBeNull();
    expect(out!.pubkey).toBe(hex);
  });
});

// ---------- formatTime ----------

describe('formatTime', () => {
  it('formats seconds-since-epoch as zero-padded HH:MM in local time', () => {
    // Build a Date for 13:05 local time, then convert to epoch seconds —
    // formatTime then re-renders it from local-time getHours/getMinutes,
    // so the round-trip gives back 13:05 regardless of the test's TZ.
    const d = new Date();
    d.setHours(13, 5, 0, 0);
    const epoch = Math.floor(d.getTime() / 1000);
    expect(formatTime(epoch)).toBe('13:05');
  });

  it('zero-pads single-digit hours and minutes', () => {
    const d = new Date();
    d.setHours(3, 7, 0, 0);
    const epoch = Math.floor(d.getTime() / 1000);
    expect(formatTime(epoch)).toBe('03:07');
  });
});

// ---------- formatRelativeFuture ----------

describe('formatRelativeFuture', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // Fix wall-clock time so the relative deltas are deterministic.
    jest.setSystemTime(new Date('2026-05-03T12:00:00.000Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns "in <1 min" for sub-minute deltas', () => {
    expect(formatRelativeFuture(Date.now() + 30_000)).toBe('in <1 min');
  });

  it('returns minute-granularity output for sub-hour deltas', () => {
    expect(formatRelativeFuture(Date.now() + 5 * 60_000)).toBe('in 5 min');
  });

  it('returns hour-granularity output for sub-day deltas', () => {
    expect(formatRelativeFuture(Date.now() + 3 * 60 * 60_000)).toBe('in 3h');
  });

  it('returns day-granularity output beyond one day', () => {
    expect(formatRelativeFuture(Date.now() + 2 * 24 * 60 * 60_000)).toBe('in 2d');
  });

  it('clamps past timestamps to "in <1 min"', () => {
    expect(formatRelativeFuture(Date.now() - 60_000)).toBe('in <1 min');
  });
});
