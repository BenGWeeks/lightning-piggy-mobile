// Round-trip + TTL + LRU + cache-key coverage for the link-preview cache (#441).
// Mirrors the patterns established in zapSenderProfileStorage so reviewers
// familiar with that file can scan the diff quickly.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  __TEST__,
  __resetForTests,
  cacheKeyFor,
  get,
  set,
  type LinkPreview,
} from './linkPreviewStorage';

function preview(overrides: Partial<LinkPreview> = {}): LinkPreview {
  return {
    url: 'https://example.com/article',
    title: 'An article',
    description: 'A short summary of the article',
    image: 'https://example.com/hero.png',
    siteName: 'Example',
    domain: 'example.com',
    ...overrides,
  };
}

describe('linkPreviewStorage', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    __resetForTests();
  });

  describe('cacheKeyFor', () => {
    it('strips query parameters', () => {
      expect(cacheKeyFor('https://example.com/x?utm_source=twitter')).toBe('https://example.com/x');
    });

    it('strips hash fragment', () => {
      expect(cacheKeyFor('https://example.com/x#section')).toBe('https://example.com/x');
    });

    it('strips both query and fragment', () => {
      expect(cacheKeyFor('https://example.com/x?utm=foo#section')).toBe('https://example.com/x');
    });

    it('returns the original string for unparseable input', () => {
      expect(cacheKeyFor('not a url')).toBe('not a url');
    });
  });

  it('persists and reloads a preview across in-memory cache resets', async () => {
    const url = 'https://example.com/article';
    await set(url, preview({ title: 'Hello' }));

    // Drop the in-memory mirror to force a re-read from AsyncStorage.
    __resetForTests();

    const hit = await get(url);
    expect(hit).not.toBeNull();
    expect(hit?.title).toBe('Hello');
  });

  it('returns null for an unknown URL', async () => {
    expect(await get('https://nope.example.com')).toBeNull();
  });

  it('returns null on empty input', async () => {
    expect(await get('')).toBeNull();
  });

  it('UTM-tagged variants share one cache entry', async () => {
    await set('https://example.com/x?utm_source=twitter', preview({ title: 'Twitter copy' }));
    // Different utm tag → same cache key → reads back the previously-stored preview.
    const hit = await get('https://example.com/x?utm_source=primal');
    expect(hit?.title).toBe('Twitter copy');
  });

  it('treats entries older than TTL_MS as misses', async () => {
    const url = 'https://example.com/article';
    await set(url, preview({ title: 'aged' }));

    const realNow = Date.now;
    try {
      jest.spyOn(Date, 'now').mockImplementation(() => realNow() + __TEST__.TTL_MS + 1);
      expect(await get(url)).toBeNull();
    } finally {
      (Date.now as jest.Mock).mockRestore?.();
    }
  });

  it('still returns entries inside the TTL window', async () => {
    const url = 'https://example.com/article';
    await set(url, preview({ title: 'fresh' }));

    const realNow = Date.now;
    try {
      jest.spyOn(Date, 'now').mockImplementation(() => realNow() + __TEST__.TTL_MS - 1000);
      expect(await get(url)).not.toBeNull();
    } finally {
      (Date.now as jest.Mock).mockRestore?.();
    }
  });

  it('evicts the oldest entries once the LRU cap is exceeded', async () => {
    const realNow = Date.now;
    let cursor = realNow();
    const tickMock = jest.spyOn(Date, 'now').mockImplementation(() => cursor);

    try {
      // Fill cache to the cap, one entry per ms.
      const oldestUrls: string[] = [];
      for (let i = 0; i < __TEST__.MAX_ENTRIES; i++) {
        const url = `https://example.com/page-${i}`;
        if (i < 5) oldestUrls.push(url);
        cursor += 1;
        await set(url, preview({ title: `page-${i}` }));
      }

      const raw1 = await AsyncStorage.getItem(__TEST__.STORAGE_KEY);
      expect(Object.keys(JSON.parse(raw1!)).length).toBe(__TEST__.MAX_ENTRIES);

      // Add 5 more — expect the 5 oldest to be evicted.
      for (let i = 0; i < 5; i++) {
        cursor += 1;
        await set(`https://example.com/new-${i}`, preview({ title: `new-${i}` }));
      }

      const raw2 = await AsyncStorage.getItem(__TEST__.STORAGE_KEY);
      const after = JSON.parse(raw2!) as Record<string, unknown>;
      expect(Object.keys(after).length).toBe(__TEST__.MAX_ENTRIES);
      for (const url of oldestUrls) {
        expect(after[url]).toBeUndefined();
      }
    } finally {
      tickMock.mockRestore();
    }
  });

  it('set on an empty url is a no-op (no AsyncStorage write)', async () => {
    const setSpy = jest.spyOn(AsyncStorage, 'setItem');
    setSpy.mockClear();
    await set('', preview());
    expect(setSpy).not.toHaveBeenCalled();
    setSpy.mockRestore();
  });
});
