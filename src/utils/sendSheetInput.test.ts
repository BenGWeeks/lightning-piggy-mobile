import {
  editAddressPrefill,
  isLnurlString,
  isLightningAddress,
  isValidInvoice,
  lnurlFixedAmountSats,
  stripLightningPrefix,
} from './sendSheetInput';

describe('sendSheetInput detectors', () => {
  describe('isLnurlString', () => {
    it('matches bech32 lnurl, LUD-17 schemes, and a lightning: prefix', () => {
      expect(isLnurlString('LNURL1DP68GURN8GHJ7')).toBe(true);
      expect(isLnurlString('lnurl1dp68gurn8ghj7')).toBe(true);
      expect(isLnurlString('lnurlp://host/pay')).toBe(true);
      expect(isLnurlString('lnurlw://host/withdraw')).toBe(true);
      expect(isLnurlString('lightning:LNURL1DP68GURN8GHJ7')).toBe(true);
      expect(isLnurlString('  lightning:lnurlp://host  ')).toBe(true);
    });
    it('does not match lightning addresses or bolt11 invoices', () => {
      expect(isLnurlString('alice@example.com')).toBe(false);
      expect(isLnurlString('lnbc100n1p...')).toBe(false);
      expect(isLnurlString('lightning:lnbc100n1p...')).toBe(false);
      expect(isLnurlString('bc1qxy...')).toBe(false);
      expect(isLnurlString('')).toBe(false);
    });
  });

  describe('isLightningAddress', () => {
    it('matches user@host but not invoices', () => {
      expect(isLightningAddress('alice@example.com')).toBe(true);
      expect(isLightningAddress('lnbc1@x')).toBe(false); // starts with lnbc
      expect(isLightningAddress('LNURL1...')).toBe(false);
    });
  });

  describe('isValidInvoice', () => {
    it('matches the bolt11 HRPs', () => {
      expect(isValidInvoice('lnbc100n1p...')).toBe(true);
      expect(isValidInvoice('LNTB100n...')).toBe(true);
      expect(isValidInvoice('alice@example.com')).toBe(false);
    });
  });

  describe('stripLightningPrefix', () => {
    it('strips a case-insensitive lightning: prefix and surrounding whitespace', () => {
      expect(stripLightningPrefix('lightning:lnbc100n1p')).toBe('lnbc100n1p');
      expect(stripLightningPrefix('LIGHTNING:lnbc100n1p')).toBe('lnbc100n1p');
      expect(stripLightningPrefix('  lightning:LNURL1DP68  ')).toBe('LNURL1DP68');
    });
    it('leaves a bare payload untouched', () => {
      expect(stripLightningPrefix('lnbc100n1p')).toBe('lnbc100n1p');
      expect(stripLightningPrefix('alice@example.com')).toBe('alice@example.com');
    });
    it('keeps a prefixed bolt11 invoice payable — the strip yields a valid invoice', () => {
      // The defect users hit: pasting `lightning:lnbc…` (copied with the URI
      // scheme) must still decode/pay. After stripping, isValidInvoice agrees.
      expect(isValidInvoice('lightning:lnbc100n1p')).toBe(false); // prefix not stripped → rejected
      expect(isValidInvoice(stripLightningPrefix('lightning:lnbc100n1p'))).toBe(true);
    });
  });

  describe('editAddressPrefill', () => {
    it('prefers the live paste-box text so a typo is editable in place', () => {
      // The dead-end the user hits: a mistyped address. "Edit address" must
      // hand back exactly what they typed so they can fix the one bad char.
      expect(editAddressPrefill('alice@exmaple.com', 'alice@exmaple.com')).toBe(
        'alice@exmaple.com',
      );
    });
    it('falls back to the parsed target when the box was never used (scan / NFC / initialAddress)', () => {
      expect(editAddressPrefill('', 'bob@example.com')).toBe('bob@example.com');
      expect(editAddressPrefill(null, 'bob@example.com')).toBe('bob@example.com');
      expect(editAddressPrefill(undefined, 'lnbc100n1p')).toBe('lnbc100n1p');
    });
    it('trims surrounding whitespace from whichever source wins', () => {
      expect(editAddressPrefill('  alice@example.com  ', null)).toBe('alice@example.com');
      expect(editAddressPrefill('   ', '  bob@example.com ')).toBe('bob@example.com');
    });
    it('returns empty string when there is nothing to recover (never "null")', () => {
      expect(editAddressPrefill('', '')).toBe('');
      expect(editAddressPrefill(null, null)).toBe('');
      expect(editAddressPrefill(undefined, undefined)).toBe('');
    });
  });

  describe('lnurlFixedAmountSats', () => {
    it('returns the amount when min === max', () => {
      expect(lnurlFixedAmountSats({ minSats: 100, maxSats: 100 })).toBe(100);
      expect(lnurlFixedAmountSats({ minSats: 1, maxSats: 1 })).toBe(1);
    });
    it('returns null for an open range', () => {
      expect(lnurlFixedAmountSats({ minSats: 1, maxSats: 100_000 })).toBe(null);
      expect(lnurlFixedAmountSats({ minSats: 99, maxSats: 100 })).toBe(null);
    });
    it('returns null for missing params or a zero amount', () => {
      expect(lnurlFixedAmountSats(null)).toBe(null);
      expect(lnurlFixedAmountSats({ minSats: 0, maxSats: 0 })).toBe(null);
    });
  });
});
