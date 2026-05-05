/**
 * Unit tests for the NFC tag URL-classification helper. The classifier
 * is the seam between the foreground tag listener and the LNURL-withdraw
 * claim flow (issue #103) — when this misfires we either ignore valid
 * gift-card tags (false negative) or surface a confusing claim dialog
 * for unrelated tags (false positive). Both regressions are user-
 * visible, hence the dedicated test surface.
 */

import { parseNfcContent } from './nfcService';

describe('parseNfcContent', () => {
  describe('lnurlw:// (LUD-17 LNURL-withdraw)', () => {
    it('classifies a plain lnurlw:// URL as lnurl-withdraw and rewrites scheme to https', () => {
      const result = parseNfcContent('lnurlw://example.com/api/v1/lnurl/cb/abc123');
      expect(result).toEqual({
        type: 'lnurl-withdraw',
        data: 'https://example.com/api/v1/lnurl/cb/abc123',
      });
    });

    it('strips a leading lightning: prefix before classifying', () => {
      const result = parseNfcContent('lightning:lnurlw://example.com/api/v1/cb/x');
      expect(result.type).toBe('lnurl-withdraw');
      expect(result.data).toBe('https://example.com/api/v1/cb/x');
    });

    it('preserves query-string casing (k1 tokens are case-sensitive)', () => {
      const result = parseNfcContent(
        'lnurlw://lnbits.example.com/withdraw/api/v1/lnurl/cb?k1=AbCdEf123XyZ',
      );
      expect(result.data).toBe(
        'https://lnbits.example.com/withdraw/api/v1/lnurl/cb?k1=AbCdEf123XyZ',
      );
    });

    it('uses http:// for .onion hosts (Tor provides equivalent transport security)', () => {
      const result = parseNfcContent('lnurlw://abc123.onion/api/v1/lnurl/cb/abc');
      expect(result).toEqual({
        type: 'lnurl-withdraw',
        data: 'http://abc123.onion/api/v1/lnurl/cb/abc',
      });
    });

    it('accepts uppercase scheme (NDEF URI records sometimes upper-case)', () => {
      const result = parseNfcContent('LNURLW://example.com/cb');
      expect(result.type).toBe('lnurl-withdraw');
    });
  });

  describe('LNURL bech32 (lnurl1…)', () => {
    it('classifies a bech32 LNURL string as lnurl (resolution decides pay vs withdraw)', () => {
      // Real-shape bech32 string; classifier doesn't validate the
      // checksum, that's lnurlService.decodeLnurl's job.
      const lnurl =
        'lnurl1dp68gurn8ghj7um9wfmxjcm99e3k7mf0v9cxj0m385ekvcenxc6r2c35xvukxefcv5mkvv34x5ekzd3ev56nyd3hxqurzepexejxxepnxscrvwfnv9nxzcn9xq6xyefhvgcxxcmyxymnserxfq8fns'.toLowerCase();
      const result = parseNfcContent(lnurl);
      expect(result).toEqual({ type: 'lnurl', data: lnurl });
    });

    it('strips the lightning: prefix from a bech32 LNURL', () => {
      const lnurl =
        'lnurl1dp68gurn8ghj7um9wfmxjcm99e3k7mf0v9cxj0m385ekvcenxc6r2c35xvukxefcv5mkvv34x5ekzd3ev56nyd3hxqurzepexejxxepnxscrvwfnv9nxzcn9xq6xyefhvgcxxcmyxymnserxfq8fns';
      const result = parseNfcContent(`lightning:${lnurl}`);
      expect(result.type).toBe('lnurl');
      expect(result.data.startsWith('lnurl1')).toBe(true);
    });
  });

  describe('lightning invoices (bolt11)', () => {
    it('classifies an lnbc invoice as lightning-invoice', () => {
      const inv = 'lnbc1500n1pn3xyzpp5qqqsyqcyq5rqwzqfpg9scrgwpugpzysnzs2pjjtw';
      expect(parseNfcContent(inv)).toEqual({ type: 'lightning-invoice', data: inv });
    });

    it('does not misclassify lnurl1 as a lightning invoice (lnbc/lntb/lnts/lnbs prefixes only)', () => {
      const result = parseNfcContent('lnurl1abc');
      expect(result.type).toBe('lnurl');
    });
  });

  describe('lightning addresses (user@domain)', () => {
    it('classifies a user@domain string as lightning-address', () => {
      expect(parseNfcContent('alice@getalby.com')).toEqual({
        type: 'lightning-address',
        data: 'alice@getalby.com',
      });
    });
  });

  describe('Nostr npub identities', () => {
    it('classifies a bare npub1… as npub', () => {
      const npub = 'npub1' + 'q'.repeat(58);
      expect(parseNfcContent(npub)).toEqual({ type: 'npub', data: npub });
    });

    it('strips the nostr: prefix from a prefixed npub', () => {
      const npub = 'npub1' + 'q'.repeat(58);
      expect(parseNfcContent(`nostr:${npub}`)).toEqual({ type: 'npub', data: npub });
    });
  });

  describe('bitcoin: URIs (BIP-21)', () => {
    it('falls through to unknown — receive flow handles BIP-21 elsewhere', () => {
      // The classifier is the LNURL-withdraw entry point; on-chain
      // tags are out of scope for the NFC listener (#103). Returning
      // `unknown` here means the listener silently ignores the tap,
      // which is the right behaviour — tags meant for the receive
      // sheet are surfaced through the QR scan path instead.
      const result = parseNfcContent(
        'bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh?amount=0.001',
      );
      expect(result.type).toBe('unknown');
    });
  });

  describe('safety: do not false-positive lnurl-withdraw on look-alikes', () => {
    it('does not classify an lnurlp:// (pay) URL as lnurl-withdraw', () => {
      const result = parseNfcContent('lnurlp://example.com/api/v1/lnurl/pay');
      // We don't currently surface a typed `lnurl-pay` for raw URLs —
      // the NFC withdraw listener wants explicit-withdraw tags only,
      // so anything else falls through to unknown and is ignored.
      expect(result.type).not.toBe('lnurl-withdraw');
    });

    it('does not classify a plain https:// URL as lnurl-withdraw without the lnurlw: scheme', () => {
      // A bare https URL on a tag is ambiguous (could be a wiki link,
      // a regular Lightning gift-card landing page, anything). The
      // listener only fires on explicit-scheme withdraw tags so a
      // misread tag doesn't pop a "claim funds?" dialog.
      const result = parseNfcContent('https://example.com/api/v1/lnurl/cb');
      expect(result.type).toBe('unknown');
    });

    it('handles whitespace around the payload', () => {
      const result = parseNfcContent('  lnurlw://example.com/cb  ');
      expect(result.type).toBe('lnurl-withdraw');
    });
  });
});
