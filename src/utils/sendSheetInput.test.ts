import { isLnurlString, isLightningAddress, isValidInvoice } from './sendSheetInput';

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
});
