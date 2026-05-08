// Fetches OG metadata for a URL and normalises it into the shape the
// MessageLinkPreview card expects (#441).
//
// We chose `link-preview-js` (fetcher-only, no UI) over `@flyerhq/...`
// (bundles a card we'd have to override to match the brand) — see
// `docs/PACKAGES.adoc` for the full rationale.
import { getLinkPreview } from 'link-preview-js';
import { get as readCache, set as writeCache, type LinkPreview } from './linkPreviewStorage';

// Hard cap on the OG fetch — we don't want a slow site to hold up
// a render slot indefinitely. 8 s is generous enough for a cold TLS
// handshake on a flaky cellular connection but short enough that
// stalled previews fall back to "no card" quickly.
const FETCH_TIMEOUT_MS = 8000;

// Reasonable desktop-ish UA so badly-configured CDNs serve OG tags
// rather than mobile-app deep links. link-preview-js defaults to a
// generic fetch UA which some hosts (Substack, Medium) treat as a
// bot and serve a stub.
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

async function fetchAndNormalise(url: string): Promise<LinkPreview | null> {
  try {
    const raw = await getLinkPreview(url, {
      timeout: FETCH_TIMEOUT_MS,
      followRedirects: 'follow',
      headers: { 'User-Agent': USER_AGENT },
    });

    // The shape from link-preview-js varies by content type — we only
    // render the HTML preview shape (mediaType: 'website' or similar
    // with `title`). For audio/video/image/application responses there
    // is no title field, so we treat that as "no preview".
    const r = raw as {
      url?: string;
      title?: string;
      siteName?: string;
      description?: string;
      images?: string[];
    };

    if (!r.title) return null;

    const preview: LinkPreview = {
      url: r.url || url,
      title: r.title,
      description: r.description ?? null,
      image: r.images && r.images.length > 0 ? r.images[0] : null,
      siteName: r.siteName ?? null,
      domain: deriveDomain(r.url || url),
    };
    return preview;
  } catch {
    // Any failure (network, parse, timeout, non-HTML) → no preview.
    // Per the issue spec we silently fall back; no toast.
    return null;
  }
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
