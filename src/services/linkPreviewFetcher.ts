// Fetches OG metadata for a URL and normalises it into the shape the
// MessageLinkPreview card expects (#441).
//
// Hand-rolled vs lib: we previously pulled in `link-preview-js` (which
// transitively bundles cheerio, ~1.6 MB). For OG-tag extraction that's
// massive overkill — OG tags are flat <meta> elements and a small
// regex sweep covers >99% of real pages. See `src/utils/parseOgMeta.ts`
// + `docs/PACKAGES.adoc` for the full rationale.
//
// Safety (#1338): a message author controls the URL, so every request this
// module makes must go to a PUBLIC address. Each hop is checked with the
// shared `isPublicHttpUrl` helper, redirects are followed MANUALLY (max
// MAX_REDIRECTS hops, each re-validated before it's requested), and the
// preview's og:image is validated too, since the card loads it automatically.
//
// Why `expo/fetch` and not the global `fetch`: React Native's built-in fetch
// is whatwg-fetch over XMLHttpRequest, which IGNORES `redirect` — OkHttp
// (Android) and NSURLSession (iOS) follow 30x hops natively, so a public URL
// could bounce the request onto a LAN device before JS sees anything.
// `expo/fetch` (Expo SDK 52+) implements `redirect: 'manual'` natively: Android
// builds its OkHttp client with followRedirects(false), iOS declines the
// NSURLSession redirect; both hand back the real 3xx response WITH its
// `Location` header (unlike a browser's opaque-redirect), so we can validate
// the target before requesting it. Belt and braces: if a runtime ever follows
// a redirect anyway (a non-3xx response flagged `redirected`, or a final
// `res.url` that isn't public), the result is discarded rather than shown.
// (Note expo/fetch's Android `redirected` is OkHttp's `isRedirect`, i.e. true
// for any 3xx — so the flag is only meaningful on a non-3xx response.)
//
// Known limitation — DNS rebinding: we can't resolve DNS before the request,
// so a public hostname that resolves to a private IP still gets through.
// Trust gating (previews only auto-load for people you follow; see
// `src/utils/mediaTrust.ts`) is the mitigation.
import { fetch as expoFetch } from 'expo/fetch';
import { parseOgMeta } from '../utils/parseOgMeta';
import { isPublicHttpUrl } from '../utils/publicUrl';
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

async function readCapped(res: Response, controller: AbortController): Promise<string> {
  // Stream-read up to MAX_BYTES so a server that lies about
  // Content-Length (or omits it) still can't OOM us. Reader breaks
  // out after the cap; remaining bytes are abandoned via the abort.
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
  // Environments without ReadableStream fall through to the buffered
  // path. The Content-Length and Range hints already filtered the
  // obvious offenders.
  const text = await res.text();
  return text.length > MAX_BYTES ? text.slice(0, MAX_BYTES) : text;
}

/**
 * Fetch `url` following at most MAX_REDIRECTS redirects, validating every
 * hop with `isPublicHttpUrl` BEFORE requesting it. Returns the HTML and the
 * final URL (for resolving relative og:image paths), or null.
 */
async function fetchHtml(url: string): Promise<{ html: string; finalUrl: string } | null> {
  // One controller per hop, so a redirect's (unread) body is dropped the
  // moment we've read its Location instead of buffering natively while the
  // next hops run. One deadline covers the whole chain.
  let controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!isPublicHttpUrl(current)) return null;
      if (hop > 0) {
        controller.abort();
        controller = new AbortController();
      }
      const res = (await expoFetch(current, {
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
        redirect: 'manual',
        // No cookies: a preview fetch shouldn't carry (or collect) state.
        credentials: 'omit',
      })) as unknown as Response;
      const isRedirect = res.status >= 300 && res.status < 400;
      // We asked for manual redirects; if the runtime followed one anyway,
      // the intermediate hops were never validated — discard.
      if (!isRedirect && res.redirected) return null;
      if (res.url && !isPublicHttpUrl(res.url)) return null;
      if (isRedirect) {
        const location = res.headers.get('location');
        if (!location) return null;
        const next = resolveRedirect(location, current);
        if (!next) return null;
        current = next;
        continue;
      }
      if (!res.ok && res.status !== 206) return null;
      const ct = res.headers.get('content-type') || '';
      if (ct && !/html|xml/i.test(ct)) return null;
      // Reject hostile-large responses *before* downloading when
      // Content-Length is honest about the body size. Servers that
      // ignored the Range header still get caught here.
      const cl = res.headers.get('content-length');
      if (cl && parseInt(cl, 10) > MAX_BYTES) return null;
      const html = await readCapped(res, controller);
      return { html, finalUrl: current };
    }
    // Too many redirects.
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    // Drop any connection still open (e.g. an unread redirect body).
    controller.abort();
  }
}

/** Drop a preview image the card would auto-load from a non-public host. */
function withSafeImage(preview: LinkPreview): LinkPreview {
  if (preview.image && !isPublicHttpUrl(preview.image)) return { ...preview, image: null };
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
  if (!url || !isPublicHttpUrl(url)) return null;
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
