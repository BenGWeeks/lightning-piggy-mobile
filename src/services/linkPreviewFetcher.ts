// Fetches OG metadata for a URL and normalises it into the shape the
// MessageLinkPreview card expects (#441).
//
// Hand-rolled vs lib: we previously pulled in `link-preview-js` (which
// transitively bundles cheerio, ~1.6 MB). For OG-tag extraction that's
// massive overkill — OG tags are flat <meta> elements and a small
// regex sweep covers >99% of real pages. See `src/utils/parseOgMeta.ts`
// + `docs/PACKAGES.adoc` for the full rationale.
import { parseOgMeta } from '../utils/parseOgMeta';
import {
  cacheKeyFor,
  get as readCache,
  set as writeCache,
  type LinkPreview,
} from './linkPreviewStorage';

const FETCH_TIMEOUT_MS = 8000;
// Cap on response size so a hostile page can't OOM us by streaming
// gigabytes. Empirical floor is 1 MB — YouTube's bloated `<head>`
// places og:title at byte ~628K, past 256 KB / 512 KB. 1 MB covers
// YouTube + any other reasonable mainstream site, while still well
// within the OOM-defence range a phone can absorb on a single fetch.
const MAX_BYTES = 1024 * 1024;
// Reasonable desktop-ish UA so badly-configured CDNs serve OG tags
// rather than mobile-app deep links.
const USER_AGENT = 'Mozilla/5.0 (compatible; LightningPiggy/1.0; +https://lightningpiggy.com)';

function deriveDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// Coalesce in-flight fetches per URL so a list re-render that mounts
// the same MessageLinkPreview twice doesn't issue duplicate network
// requests.
const inFlight = new Map<string, Promise<LinkPreview | null>>();

async function fetchHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
        // Hint to cooperative servers that we only want the head of
        // the document. Servers that honour this respond 206 Partial
        // Content, capping the on-wire bytes regardless of the body
        // truncation below.
        Range: `bytes=0-${MAX_BYTES - 1}`,
      },
      redirect: 'follow',
    });
    if (!res.ok && res.status !== 206) return null;
    const ct = res.headers.get('content-type') || '';
    if (ct && !/html|xml/i.test(ct)) return null;
    // Reject hostile-large responses *before* downloading when
    // Content-Length is honest about the body size. Servers that
    // ignored the Range header still get caught here.
    const cl = res.headers.get('content-length');
    if (cl && parseInt(cl, 10) > MAX_BYTES) return null;
    // Stream-read up to MAX_BYTES so a server that lies about
    // Content-Length (or omits it) still can't OOM us. Reader breaks
    // out after the cap; remaining bytes are abandoned via the abort
    // signal in the finally block.
    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let collected = '';
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        collected += decoder.decode(value, { stream: true });
        if (total >= MAX_BYTES) {
          controller.abort();
          break;
        }
      }
      collected += decoder.decode();
      return collected.length > MAX_BYTES ? collected.slice(0, MAX_BYTES) : collected;
    }
    // Hermes / RN environments without ReadableStream fall through to
    // the buffered path. Still cheaper than nothing — the Content-
    // Length and Range hints already filtered the obvious offenders.
    const text = await res.text();
    return text.length > MAX_BYTES ? text.slice(0, MAX_BYTES) : text;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAndNormalise(url: string): Promise<LinkPreview | null> {
  const html = await fetchHtml(url);
  if (!html) return null;

  const meta = parseOgMeta(html, url);
  if (!meta.title && !meta.image) return null;

  return {
    url,
    title: meta.title ?? '',
    description: meta.description,
    image: meta.image,
    siteName: meta.siteName,
    domain: deriveDomain(url),
  };
}

// Public API: cache-first lookup, then network. Returns null when no
// preview is available (graceful fallback — the bare URL stays
// clickable in the bubble).
export async function fetchLinkPreview(url: string): Promise<LinkPreview | null> {
  if (!url) return null;
  const cached = await readCache(url);
  if (cached) return cached;
  // Coalesce on the same normalised cache key the storage layer uses,
  // so e.g. `?utm=1` and `?utm=2` variants of the same URL share one
  // in-flight fetch instead of issuing duplicates.
  const key = cacheKeyFor(url);
  const existing = inFlight.get(key);
  if (existing) return existing;
  const promise = (async () => {
    const preview = await fetchAndNormalise(url);
    if (preview) await writeCache(url, preview);
    return preview;
  })();
  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(key);
  }
}

// Test-only: drop in-flight tracking so per-test isolation works.
export function __resetForTests(): void {
  inFlight.clear();
}
