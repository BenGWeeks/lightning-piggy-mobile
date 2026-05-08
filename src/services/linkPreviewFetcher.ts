// Fetches OG metadata for a URL and normalises it into the shape the
// MessageLinkPreview card expects (#441).
//
// Hand-rolled vs lib: we previously pulled in `link-preview-js` (which
// transitively bundles cheerio, ~1.6 MB). For OG-tag extraction that's
// massive overkill — OG tags are flat <meta> elements and a small
// regex sweep covers >99% of real pages. See `src/utils/parseOgMeta.ts`
// + `docs/PACKAGES.adoc` for the full rationale.
import { parseOgMeta } from '../utils/parseOgMeta';
import { get as readCache, set as writeCache, type LinkPreview } from './linkPreviewStorage';

const FETCH_TIMEOUT_MS = 8000;
// Cap on response size so a hostile page can't OOM us by streaming
// gigabytes — OG tags live in <head> so 256 KB covers anything sane.
const MAX_BYTES = 256 * 1024;
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
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (ct && !/html|xml/i.test(ct)) return null;
    // Truncate at MAX_BYTES — OG tags are in <head> so this is plenty.
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
  const existing = inFlight.get(url);
  if (existing) return existing;
  const promise = (async () => {
    const preview = await fetchAndNormalise(url);
    if (preview) await writeCache(url, preview);
    return preview;
  })();
  inFlight.set(url, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(url);
  }
}

// Test-only: drop in-flight tracking so per-test isolation works.
export function __resetForTests(): void {
  inFlight.clear();
}
