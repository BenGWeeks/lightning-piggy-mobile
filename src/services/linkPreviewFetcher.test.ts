// Redirect validation + SSRF guards for the link-preview fetcher (#1338).
import { fetch as expoFetch } from 'expo/fetch';
import { get as readCache } from './linkPreviewStorage';
import {
  __resetForTests,
  fetchLinkPreview,
  MAX_REDIRECTS,
  resolveRedirect,
} from './linkPreviewFetcher';

// jest hoists these above the imports.
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('./linkPreviewStorage', () => ({
  cacheKeyFor: (u: string) => u,
  get: jest.fn(async () => null),
  set: jest.fn(async () => undefined),
}));

const mockFetch = expoFetch as unknown as jest.Mock;
const mockReadCache = readCache as unknown as jest.Mock;

const HTML = `<html><head>
<meta property="og:title" content="Hello" />
<meta property="og:image" content="https://cdn.example.com/a.png" />
</head></html>`;

interface FakeInit {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  redirected?: boolean;
  url?: string;
}

function fakeResponse({
  status = 200,
  headers = { 'content-type': 'text/html' },
  body = HTML,
  redirected = false,
  url = '',
}: FakeInit) {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    status,
    ok: status >= 200 && status < 300,
    redirected,
    url,
    headers: { get: (k: string) => lower[k.toLowerCase()] ?? null },
    body: null,
    text: async () => body,
  };
}

function redirectTo(location: string, status = 302) {
  return fakeResponse({ status, headers: { location }, body: '' });
}

beforeEach(() => {
  mockFetch.mockReset();
  mockReadCache.mockReset();
  mockReadCache.mockResolvedValue(null);
  __resetForTests();
});

describe('fetchLinkPreview — address checks', () => {
  it.each([
    'http://192.168.1.1/',
    'http://127.1/',
    'http://[::1]/',
    'http://169.254.169.254/latest/meta-data/',
    'http://localhost./',
    'http://router/',
  ])('never requests a private URL: %s', async (url) => {
    expect(await fetchLinkPreview(url)).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fetches a public URL with manual redirects and no cookies', async () => {
    mockFetch.mockResolvedValueOnce(fakeResponse({}));
    const p = await fetchLinkPreview('https://example.com/post');
    expect(p).toMatchObject({ title: 'Hello', image: 'https://cdn.example.com/a.png' });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://example.com/post');
    expect(init).toMatchObject({ redirect: 'manual', credentials: 'omit' });
    expect(init.headers.Range).toMatch(/^bytes=0-/);
  });
});

describe('fetchLinkPreview — redirects', () => {
  it('follows a redirect to another public URL', async () => {
    mockFetch
      .mockResolvedValueOnce(redirectTo('https://www.example.com/post'))
      .mockResolvedValueOnce(fakeResponse({}));
    const p = await fetchLinkPreview('https://example.com/post');
    expect(p?.title).toBe('Hello');
    expect(mockFetch.mock.calls.map((c) => c[0])).toEqual([
      'https://example.com/post',
      'https://www.example.com/post',
    ]);
  });

  it('resolves a relative Location against the current hop', async () => {
    mockFetch
      .mockResolvedValueOnce(redirectTo('/new/path', 301))
      .mockResolvedValueOnce(fakeResponse({}));
    await fetchLinkPreview('https://example.com/old');
    expect(mockFetch.mock.calls[1][0]).toBe('https://example.com/new/path');
  });

  it.each([
    'http://192.168.1.1/admin',
    'http://127.0.0.1:8080/',
    'http://[::ffff:10.0.0.1]/',
    'http://2130706433/',
    'http://printer.local/',
    'http://user@10.0.0.1/',
  ])('blocks a redirect to a private address: %s', async (location) => {
    mockFetch.mockResolvedValueOnce(redirectTo(location));
    expect(await fetchLinkPreview('https://example.com/r')).toBeNull();
    // Only the first (public) hop was ever requested.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('blocks a private hop later in the chain', async () => {
    mockFetch
      .mockResolvedValueOnce(redirectTo('https://hop1.example.com/'))
      .mockResolvedValueOnce(redirectTo('http://10.0.0.1/'));
    expect(await fetchLinkPreview('https://example.com/r')).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it(`gives up after ${MAX_REDIRECTS} redirects`, async () => {
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      mockFetch.mockResolvedValueOnce(redirectTo(`https://hop${i + 1}.example.com/`));
    }
    mockFetch.mockResolvedValueOnce(fakeResponse({}));
    expect(await fetchLinkPreview('https://example.com/r')).toBeNull();
    // Initial request + MAX_REDIRECTS followed hops; the 4th redirect isn't followed.
    expect(mockFetch).toHaveBeenCalledTimes(MAX_REDIRECTS + 1);
  });

  it('follows exactly MAX_REDIRECTS redirects', async () => {
    for (let i = 0; i < MAX_REDIRECTS; i++) {
      mockFetch.mockResolvedValueOnce(redirectTo(`https://hop${i + 1}.example.com/`));
    }
    mockFetch.mockResolvedValueOnce(fakeResponse({}));
    expect((await fetchLinkPreview('https://example.com/r'))?.title).toBe('Hello');
  });

  it('gives up on a redirect with no Location', async () => {
    mockFetch.mockResolvedValueOnce(fakeResponse({ status: 302, headers: {}, body: '' }));
    expect(await fetchLinkPreview('https://example.com/r')).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('discards a response the runtime redirected despite manual mode', async () => {
    mockFetch.mockResolvedValueOnce(fakeResponse({ redirected: true }));
    expect(await fetchLinkPreview('https://example.com/r')).toBeNull();
  });

  it('discards a response whose final URL is private', async () => {
    mockFetch.mockResolvedValueOnce(fakeResponse({ url: 'http://192.168.0.1/' }));
    expect(await fetchLinkPreview('https://example.com/r')).toBeNull();
  });
});

describe('fetchLinkPreview — preview image', () => {
  it('drops an og:image on a private host', async () => {
    mockFetch.mockResolvedValueOnce(
      fakeResponse({
        body: `<meta property="og:title" content="T" /><meta property="og:image" content="http://192.168.1.1/cam.jpg" />`,
      }),
    );
    const p = await fetchLinkPreview('https://example.com/');
    expect(p).toMatchObject({ title: 'T', image: null });
  });

  it('drops a private image from a cached (pre-#1338) entry', async () => {
    mockReadCache.mockResolvedValueOnce({
      url: 'https://example.com/',
      title: 'T',
      description: null,
      image: 'http://10.0.0.1/x.png',
      siteName: null,
      domain: 'example.com',
    });
    const p = await fetchLinkPreview('https://example.com/');
    expect(p?.image).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('fetchLinkPreview — existing caps', () => {
  it('rejects non-HTML content', async () => {
    mockFetch.mockResolvedValueOnce(fakeResponse({ headers: { 'content-type': 'image/png' } }));
    expect(await fetchLinkPreview('https://example.com/a.png')).toBeNull();
  });

  it('rejects an oversized Content-Length', async () => {
    mockFetch.mockResolvedValueOnce(
      fakeResponse({ headers: { 'content-type': 'text/html', 'content-length': '99999999' } }),
    );
    expect(await fetchLinkPreview('https://example.com/')).toBeNull();
  });

  it('returns null when fetch throws (timeout / abort)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('aborted'));
    expect(await fetchLinkPreview('https://example.com/')).toBeNull();
  });
});

describe('resolveRedirect', () => {
  it('handles absolute, protocol-relative and relative locations', () => {
    expect(resolveRedirect('https://b.example.com/x', 'https://a.example.com/')).toBe(
      'https://b.example.com/x',
    );
    expect(resolveRedirect('//b.example.com/x', 'https://a.example.com/')).toBe(
      'https://b.example.com/x',
    );
    expect(resolveRedirect('../y', 'https://a.example.com/p/q')).toBe('https://a.example.com/y');
  });
});
