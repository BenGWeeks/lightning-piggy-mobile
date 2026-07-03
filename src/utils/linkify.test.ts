import { linkifySegments, hasLink } from './linkify';

describe('linkifySegments (#663 — tappable URLs in messages)', () => {
  it('returns a single plain segment for text with no URL', () => {
    expect(linkifySegments('hello there')).toEqual([{ text: 'hello there' }]);
  });

  it('linkifies a bare URL', () => {
    expect(linkifySegments('https://x.com/foo')).toEqual([
      { text: 'https://x.com/foo', url: 'https://x.com/foo' },
    ]);
  });

  it('keeps surrounding text plain and only links the URL', () => {
    expect(linkifySegments('check this https://x.com/foo cheers')).toEqual([
      { text: 'check this ' },
      { text: 'https://x.com/foo', url: 'https://x.com/foo' },
      { text: ' cheers' },
    ]);
  });

  it('peels a sentence-ending period off the URL', () => {
    expect(linkifySegments('see https://x.com/foo.')).toEqual([
      { text: 'see ' },
      { text: 'https://x.com/foo', url: 'https://x.com/foo' },
      { text: '.' },
    ]);
  });

  it('peels a trailing close-paren', () => {
    expect(linkifySegments('(https://x.com/foo)')).toEqual([
      { text: '(' },
      { text: 'https://x.com/foo', url: 'https://x.com/foo' },
      { text: ')' },
    ]);
  });

  it('handles multiple URLs in one message', () => {
    expect(linkifySegments('a https://one.com b http://two.org c')).toEqual([
      { text: 'a ' },
      { text: 'https://one.com', url: 'https://one.com' },
      { text: ' b ' },
      { text: 'http://two.org', url: 'http://two.org' },
      { text: ' c' },
    ]);
  });

  it('does NOT link a bare domain without a scheme', () => {
    expect(linkifySegments('go to x.com now')).toEqual([{ text: 'go to x.com now' }]);
  });

  it('links http as well as https', () => {
    expect(linkifySegments('http://example.com')).toEqual([
      { text: 'http://example.com', url: 'http://example.com' },
    ]);
  });
});

describe('hasLink', () => {
  it('detects a URL', () => {
    expect(hasLink('see https://x.com/foo')).toBe(true);
  });
  it('is false without a scheme URL', () => {
    expect(hasLink('see x.com')).toBe(false);
    expect(hasLink('plain text')).toBe(false);
  });
});
