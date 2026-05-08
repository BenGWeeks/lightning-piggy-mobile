import { extractUrls } from './extractUrls';

describe('extractUrls', () => {
  it('returns [] for empty / non-URL text', () => {
    expect(extractUrls('')).toEqual([]);
    expect(extractUrls('no urls here')).toEqual([]);
    expect(extractUrls('mailto:foo@bar.com')).toEqual([]);
    expect(extractUrls('nostr:npub1abc')).toEqual([]);
  });

  it('extracts a single bare URL', () => {
    expect(extractUrls('https://example.com')).toEqual(['https://example.com']);
  });

  it('extracts multiple distinct URLs in first-seen order', () => {
    const text = 'first https://a.example.com then https://b.example.com';
    expect(extractUrls(text)).toEqual(['https://a.example.com', 'https://b.example.com']);
  });

  it('dedupes identical URLs', () => {
    const text = 'https://x.com/foo and again https://x.com/foo';
    expect(extractUrls(text)).toEqual(['https://x.com/foo']);
  });

  it('preserves query strings and fragments', () => {
    const text = 'see https://example.com/path?q=1&r=2#section';
    expect(extractUrls(text)).toEqual(['https://example.com/path?q=1&r=2#section']);
  });

  it('strips trailing sentence punctuation', () => {
    expect(extractUrls('Check this out: https://x.com/foo.')).toEqual(['https://x.com/foo']);
    expect(extractUrls('See https://x.com/foo, then go.')).toEqual(['https://x.com/foo']);
    expect(extractUrls('really? https://x.com/foo!')).toEqual(['https://x.com/foo']);
  });

  it('balances unmatched trailing parens', () => {
    expect(extractUrls('see (https://x.com/foo)')).toEqual(['https://x.com/foo']);
    // Wikipedia-style URL with a balanced paren survives.
    expect(extractUrls('https://en.wikipedia.org/wiki/Foo_(bar)')).toEqual([
      'https://en.wikipedia.org/wiki/Foo_(bar)',
    ]);
  });

  it('handles markdown-style [label](url)', () => {
    expect(extractUrls('check [my site](https://example.com/x)')).toEqual([
      'https://example.com/x',
    ]);
  });

  it('matches http and https', () => {
    expect(extractUrls('http://insecure.example')).toEqual(['http://insecure.example']);
    expect(extractUrls('https://secure.example')).toEqual(['https://secure.example']);
  });

  it('skips non-http schemes', () => {
    expect(extractUrls('lightning:lnbc100u1p... https://x.com')).toEqual(['https://x.com']);
    expect(extractUrls('bitcoin:bc1q...?amount=1 https://y.com')).toEqual(['https://y.com']);
  });
});
