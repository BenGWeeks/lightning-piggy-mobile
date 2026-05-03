/**
 * Coverage for the pure helpers in giphyService: API-key gate
 * (`isConfigured`) and the message-body GIF detector (`extractGifUrl`).
 * The network paths (`searchGifs`, `getTrending`) are out of scope here
 * — they hit GIPHY over `fetch`, not what we want from a unit test.
 */

import { extractGifUrl, isConfigured } from './giphyService';

describe('isConfigured', () => {
  const ORIGINAL = process.env.EXPO_PUBLIC_GIPHY_API_KEY;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.EXPO_PUBLIC_GIPHY_API_KEY;
    else process.env.EXPO_PUBLIC_GIPHY_API_KEY = ORIGINAL;
  });

  it('returns true when EXPO_PUBLIC_GIPHY_API_KEY is set', () => {
    process.env.EXPO_PUBLIC_GIPHY_API_KEY = 'k123';
    expect(isConfigured()).toBe(true);
  });

  it('returns false when the env var is empty / unset', () => {
    process.env.EXPO_PUBLIC_GIPHY_API_KEY = '';
    expect(isConfigured()).toBe(false);
  });
});

describe('extractGifUrl', () => {
  it('returns null for empty input', () => {
    expect(extractGifUrl('')).toBeNull();
  });

  it('matches a bare i.giphy.com URL', () => {
    const url = 'https://i.giphy.com/media/abc123/giphy.gif';
    expect(extractGifUrl(url)).toBe(url);
  });

  it('matches numbered media subdomains', () => {
    const url = 'https://media2.giphy.com/media/abc/giphy.gif';
    expect(extractGifUrl(url)).toBe(url);
  });

  it('tolerates surrounding whitespace', () => {
    const url = 'https://i.giphy.com/media/x/giphy.gif';
    expect(extractGifUrl(`  ${url}  `)).toBe(url);
  });

  it('rejects when the URL is mid-sentence (not the entire body)', () => {
    // Per the source comment: a URL in the middle of a user-typed
    // message is still a text message, not a GIF card.
    expect(extractGifUrl('check this https://i.giphy.com/media/abc/giphy.gif please')).toBeNull();
  });

  it('rejects non-giphy hosts even with a .gif extension', () => {
    expect(extractGifUrl('https://example.com/foo.gif')).toBeNull();
  });

  it('rejects unsupported extensions on a giphy host', () => {
    // The send path emits .gif specifically; any other extension means
    // the picker / sender isn't the source — don't auto-inline.
    expect(extractGifUrl('https://media.giphy.com/media/abc/giphy.webp')).toBeNull();
  });
});
