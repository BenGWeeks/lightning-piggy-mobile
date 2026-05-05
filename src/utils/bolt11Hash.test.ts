/**
 * Sanity guards for `extractBolt11PaymentHashes` — the front door for
 * DM-bolt11 attribution (#126). Used to map `payment_hash → friend
 * pubkey` so paid bolt11 transactions can be attributed back to the
 * conversation partner who shared the invoice.
 */
import { extractBolt11PaymentHashes } from './bolt11Hash';

// Real bolt11 sample lifted from `light-bolt11-decoder/tests/basic.test.js`
// (the only known-good fixture vendored with the library). 2000 sats,
// payment_hash matches `SAMPLE_PAYMENT_HASH` below.
const SAMPLE_BOLT11 =
  'lnbc20u1p3y0x3hpp5743k2g0fsqqxj7n8qzuhns5gmkk4djeejk3wkp64ppevgekvc0jsdqcve5kzar2v9nr5gpqd4hkuetesp5ez2g297jduwc20t6lmqlsg3man0vf2jfd8ar9fh8fhn2g8yttfkqxqy9gcqcqzys9qrsgqrzjqtx3k77yrrav9hye7zar2rtqlfkytl094dsp0ms5majzth6gt7ca6uhdkxl983uywgqqqqlgqqqvx5qqjqrzjqd98kxkpyw0l9tyy8r8q57k7zpy9zjmh6sez752wj6gcumqnj3yxzhdsmg6qq56utgqqqqqqqqqqqeqqjq7jd56882gtxhrjm03c93aacyfy306m4fq0tskf83c0nmet8zc2lxyyg3saz8x6vwcp26xnrlagf9semau3qm2glysp7sv95693fphvsp54l567';
const SAMPLE_PAYMENT_HASH = 'f5636521e98000697a6700b979c288ddad56cb3995a2eb07550872c466ccc3e5';

describe('extractBolt11PaymentHashes', () => {
  it('returns an empty array for non-invoice text', () => {
    expect(extractBolt11PaymentHashes('hello world')).toEqual([]);
  });

  it('returns an empty array for empty / null-like input', () => {
    expect(extractBolt11PaymentHashes('')).toEqual([]);
    // @ts-expect-error — runtime guard against accidental null
    expect(extractBolt11PaymentHashes(null)).toEqual([]);
  });

  it('extracts the payment hash from a single bolt11', () => {
    expect(extractBolt11PaymentHashes(SAMPLE_BOLT11)).toEqual([SAMPLE_PAYMENT_HASH]);
  });

  it('handles a bolt11 with the optional `lightning:` prefix', () => {
    const hashes = extractBolt11PaymentHashes(`lightning:${SAMPLE_BOLT11}`);
    expect(hashes).toHaveLength(1);
    expect(hashes[0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('extracts a bolt11 embedded in surrounding text', () => {
    const text = `pls pay this when you can: ${SAMPLE_BOLT11} thanks!`;
    expect(extractBolt11PaymentHashes(text)).toHaveLength(1);
  });

  it('dedups when the same invoice appears twice in one body', () => {
    const text = `${SAMPLE_BOLT11} ... and again ${SAMPLE_BOLT11}`;
    expect(extractBolt11PaymentHashes(text)).toHaveLength(1);
  });

  it('silently skips malformed bolt11-shaped strings', () => {
    // Looks like a bolt11 to the regex but fails the decoder.
    const garbage = 'lnbc' + 'z'.repeat(60);
    expect(extractBolt11PaymentHashes(garbage)).toEqual([]);
  });

  it('returns lowercase hashes (storage keys must collide on case)', () => {
    const hashes = extractBolt11PaymentHashes(SAMPLE_BOLT11);
    expect(hashes[0]).toBe(hashes[0].toLowerCase());
  });
});
