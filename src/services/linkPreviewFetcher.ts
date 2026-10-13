// Fetches OG metadata for a URL and normalises it into the shape the
// MessageLinkPreview card expects (#441).
//
// Hand-rolled vs lib: we previously pulled in `link-preview-js` (which
// transitively bundles cheerio, ~1.6 MB). For OG-tag extraction that's
// massive overkill — OG tags are flat <meta> elements and a small
// regex sweep covers >99% of real pages. See `src/utils/parseOgMeta.ts`
// + `docs/PACKAGES.adoc` for the full rationale.
//
import { parseOgMeta } from '../utils/parseOgMeta';
import { checkRemoteUrl, fetchBounded, PREVIEW_MAX_BYTES } from '../utils/remoteUrlPolicy';
import {
  cacheKeyFor,
  get as readCache,
  set as writeCache,
  type LinkPreview,
} from './linkPreviewStorage';

// Overall budget for the whole redirect chain, not per hop.
const FETCH_TIMEOUT_MS = 8000;
// Redirect hops we'll follow (each validated) before giving up.
export const MAX_REDIRECTS = 3;
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

/**
 * Resolve a redirect `Location` against the URL that returned it. Returns
 * null when it can't be parsed. The result is re-validated by the caller, so
 * a resolver quirk can only produce a URL that then gets rejected.
 */
export function resolveRedirect(location: string, base: string): string | null {
  try {
    return new URL(location, base).toString();
  } catch {
    return null;
  }
}

async function fetchHtml(url: string): Promise<{ html: string; finalUrl: string } | null> {
  try {
    const result = await fetchBounded(url, {
      maxBytes: PREVIEW_MAX_BYTES,
      timeoutMs: FETCH_TIMEOUT_MS,
      redirects: 'https-only',
      maxRedirects: 3,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
        Range: `bytes=0-${MAX_BYTES - 1}`,
      },
    });
    const ct = result.headers.get('content-type') || '';
    if (ct && !/html|xml/i.test(ct)) return null;
    return { html: new TextDecoder().decode(result.bytes), finalUrl: result.url };
  } catch {
    return null;
  }
}

/** Drop a preview image the card would auto-load from a non-public host. */
function withSafeImage(preview: LinkPreview): LinkPreview {
  if (preview.image && !checkRemoteUrl(preview.image, { kind: 'preview' }).ok)
    return { ...preview, image: null };
  return preview;
}

async function fetchAndNormalise(url: string): Promise<LinkPreview | null> {
  const fetched = await fetchHtml(url);
  if (!fetched) return null;

  const meta = parseOgMeta(fetched.html, fetched.finalUrl);
  if (!meta.title && !meta.image) return null;

  return withSafeImage({
    url,
    title: meta.title ?? '',
    description: meta.description,
    image: meta.image,
    siteName: meta.siteName,
    domain: deriveDomain(url),
  });
}

// Public API: cache-first lookup, then network. Returns null when no
// preview is available (graceful fallback — the bare URL stays
// clickable in the bubble).
export async function fetchLinkPreview(url: string): Promise<LinkPreview | null> {
  if (!url || !checkRemoteUrl(url, { kind: 'preview' }).ok) return null;
  const cached = await readCache(url);
  // Re-check cached image URLs: entries written before #1338 weren't filtered.
  if (cached) return withSafeImage(cached);
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
