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

  // Realistic message shapes — synthetic "first ... then ..." cases
  // were missing the actual hosts users share most often. These probe
  // Twitter / YouTube / Wikipedia / GitHub URLs with text before, after,
  // or either side of the URL. Each case asserts the exact extracted
  // URL so a regression in URL-boundary handling fails visibly here
  // rather than silently in the rendered preview.
  describe('realistic message shapes', () => {
    it('Wikipedia — text before only', () => {
      expect(extractUrls('Check this out: https://en.wikipedia.org/wiki/Bitcoin')).toEqual([
        'https://en.wikipedia.org/wiki/Bitcoin',
      ]);
    });

    it('Wikipedia — text after only', () => {
      expect(extractUrls('https://en.wikipedia.org/wiki/Bitcoin is interesting')).toEqual([
        'https://en.wikipedia.org/wiki/Bitcoin',
      ]);
    });

    it('Wikipedia — text either side, balanced parens preserved', () => {
      expect(
        extractUrls('See https://en.wikipedia.org/wiki/Bitcoin_(currency) which covers history'),
      ).toEqual(['https://en.wikipedia.org/wiki/Bitcoin_(currency)']);
    });

    it('Wikipedia — url-with-fragment + text after', () => {
      expect(extractUrls('Look at https://en.wikipedia.org/wiki/Bitcoin#History please')).toEqual([
        'https://en.wikipedia.org/wiki/Bitcoin#History',
      ]);
    });

    it('Twitter — text before', () => {
      expect(extractUrls('Read this https://twitter.com/jack/status/1')).toEqual([
        'https://twitter.com/jack/status/1',
      ]);
    });

    it('Twitter — text after with sentence punctuation', () => {
      expect(extractUrls('https://twitter.com/jack/status/1 is from 2006.')).toEqual([
        'https://twitter.com/jack/status/1',
      ]);
    });

    it('Twitter — text either side, with surrounding emoji', () => {
      expect(extractUrls('🐦 see https://twitter.com/example/status/123 and reply 🙂')).toEqual([
        'https://twitter.com/example/status/123',
      ]);
    });

    it('x.com (the rebrand) with text before', () => {
      expect(extractUrls('latest tweet: https://x.com/elonmusk/status/9999')).toEqual([
        'https://x.com/elonmusk/status/9999',
      ]);
    });

    it('YouTube — text before', () => {
      expect(extractUrls('watch this: https://youtube.com/watch?v=dQw4w9WgXcQ')).toEqual([
        'https://youtube.com/watch?v=dQw4w9WgXcQ',
      ]);
    });

    it('YouTube — text after', () => {
      expect(extractUrls('https://youtube.com/watch?v=dQw4w9WgXcQ is timeless')).toEqual([
        'https://youtube.com/watch?v=dQw4w9WgXcQ',
      ]);
    });

    it('YouTube — short youtu.be form with text either side', () => {
      expect(extractUrls('try https://youtu.be/dQw4w9WgXcQ now')).toEqual([
        'https://youtu.be/dQw4w9WgXcQ',
      ]);
    });

    it('YouTube — multiple query params, text before', () => {
      expect(
        extractUrls('with timestamp: https://youtube.com/watch?v=abcd&t=42s&list=PLxx'),
      ).toEqual(['https://youtube.com/watch?v=abcd&t=42s&list=PLxx']);
    });

    it('GitHub — text either side, trailing question mark stripped', () => {
      expect(
        extractUrls('did you see https://github.com/lightning-piggy/lightning-piggy?'),
      ).toEqual(['https://github.com/lightning-piggy/lightning-piggy']);
    });

    it('multiple links + text — first-seen order, both extracted', () => {
      expect(
        extractUrls(
          'compare https://en.wikipedia.org/wiki/Bitcoin with https://en.wikipedia.org/wiki/Lightning_Network please',
        ),
      ).toEqual([
        'https://en.wikipedia.org/wiki/Bitcoin',
        'https://en.wikipedia.org/wiki/Lightning_Network',
      ]);
    });

    it('URL inside parens with surrounding text — paren stripped, URL clean', () => {
      expect(
        extractUrls('the source (https://en.wikipedia.org/wiki/Bitcoin) confirms it'),
      ).toEqual(['https://en.wikipedia.org/wiki/Bitcoin']);
    });

    it('URL with fragment + comma after — comma stripped', () => {
      expect(
        extractUrls('jump to https://en.wikipedia.org/wiki/Bitcoin#History, then read on'),
      ).toEqual(['https://en.wikipedia.org/wiki/Bitcoin#History']);
    });

    it('URL with quote characters around it — opening quote not consumed', () => {
      expect(extractUrls('he said "https://en.wikipedia.org/wiki/Bitcoin" was good')).toEqual([
        'https://en.wikipedia.org/wiki/Bitcoin',
      ]);
    });
  });
});
