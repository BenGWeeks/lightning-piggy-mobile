import Constants from 'expo-constants';

// GIPHY v1 REST client. Kid-appropriate content is enforced on every
// request by pinning `rating=g` — GIPHY's own "General Audiences" tier.
// See https://developers.giphy.com/docs/optional-settings#rating
//
// The API key is bundled into the JS at build time via `app.config.ts`'s
// `extra.giphyApiKey` (fed from `EXPO_PUBLIC_GIPHY_API_KEY`). GIPHY keys
// are public by design — in the GIPHY dashboard restrict the key to an
// Android package / iOS bundle ID; don't treat it as a secret.

const GIPHY_BASE = 'https://api.giphy.com/v1';

const DEFAULT_LIMIT = 24;

export interface Gif {
  id: string;
  /** Direct `.gif` URL suitable for `<Image>`/`<ExpoImage>` and for sharing in a DM. */
  url: string;
  /**
   * Animated preview used in the picker grid for tiles currently
   * visible in the viewport. ~50–200 KB per GIF + on-device decode.
   */
  previewUrl: string;
  /**
   * Static single-frame thumbnail for the picker grid. Rendered for
   * off-screen tiles so the picker scrolls smoothly without paying the
   * download + decode cost for hundreds of GIFs the user may never see.
   * ~5–15 KB per image, near-instant.
   */
  previewStillUrl: string;
  title: string;
}

interface GiphyImageFormat {
  url?: string;
}

interface GiphyResult {
  id: string;
  title?: string;
  images?: Record<string, GiphyImageFormat>;
}

interface GiphyResponse {
  data: GiphyResult[];
}

function getApiKey(): string | null {
  const fromExtra = (Constants.expoConfig?.extra as Record<string, unknown> | undefined)
    ?.giphyApiKey;
  if (typeof fromExtra === 'string' && fromExtra.length > 0) return fromExtra;
  // Fall-through for Expo Go / development where `extra` wiring isn't set
  // up. `EXPO_PUBLIC_` env vars are inlined by Metro at bundle time.
  const fromEnv = process.env.EXPO_PUBLIC_GIPHY_API_KEY;
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  return null;
}

export function isConfigured(): boolean {
  return getApiKey() !== null;
}

function pickFormat(
  images: Record<string, GiphyImageFormat> | undefined,
  order: string[],
): GiphyImageFormat | null {
  if (!images) return null;
  for (const key of order) {
    const fmt = images[key];
    if (fmt && typeof fmt.url === 'string' && fmt.url.length > 0) return fmt;
  }
  return null;
}

function normalize(result: GiphyResult): Gif | null {
  // Send-order: prefer a reasonably-sized downsized variant so the bubble
  // renders crisply without pulling down the multi-megabyte original.
  const send = pickFormat(result.images, [
    'fixed_width',
    'downsized_medium',
    'downsized',
    'original',
  ]);
  // Animated preview (rendered only for visible tiles in the picker).
  const preview = pickFormat(result.images, [
    'fixed_width_small',
    'fixed_height_small',
    'preview_gif',
    'fixed_width',
    'original',
  ]);
  // Static-frame thumbnail (rendered for off-screen tiles + fast scrolls).
  // GIPHY exposes `*_still` siblings of every animated variant.
  const previewStill = pickFormat(result.images, [
    'fixed_width_small_still',
    'fixed_height_small_still',
    'fixed_width_still',
    'fixed_height_still',
    'original_still',
  ]);
  if (!send?.url || !preview?.url) return null;
  return {
    id: result.id,
    url: send.url,
    previewUrl: preview.url,
    // Fall back to the animated preview if no still variant is offered
    // (older GIPHY entries occasionally lack the `_still` images).
    previewStillUrl: previewStill?.url || preview.url,
    title: result.title || '',
  };
}

async function fetchGiphy(path: string, params: Record<string, string>): Promise<GiphyResponse> {
  const key = getApiKey();
  if (!key) {
    throw new Error('GIPHY API key is not configured');
  }
  const qs = new URLSearchParams({
    api_key: key,
    ...params,
    // `rating` is pinned AFTER the caller-supplied params so no caller
    // can accidentally (or maliciously) loosen the safety filter by
    // passing their own `rating` key.
    rating: 'g',
  });
  const res = await fetch(`${GIPHY_BASE}${path}?${qs.toString()}`);
  if (!res.ok) {
    throw new Error(`GIPHY request failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as GiphyResponse;
}

export async function searchGifs(query: string, limit = DEFAULT_LIMIT): Promise<Gif[]> {
  const q = query.trim();
  if (!q) return getTrending(limit);
  const data = await fetchGiphy('/gifs/search', {
    q,
    limit: String(limit),
    lang: 'en',
    bundle: 'messaging_non_clips',
  });
  return data.data.map(normalize).filter((g): g is Gif => g !== null);
}

export async function getTrending(limit = DEFAULT_LIMIT): Promise<Gif[]> {
  const data = await fetchGiphy('/gifs/trending', {
    limit: String(limit),
    bundle: 'messaging_non_clips',
  });
  return data.data.map(normalize).filter((g): g is Gif => g !== null);
}

// GIPHY-hosted direct GIF URL. We anchor on the known media hosts rather
// than `.gif` alone so an arbitrary `example.com/foo.gif` in a DM doesn't
// get silently upgraded to an auto-playing image bubble — only GIFs we
// recognise as coming from our own picker render inline.
// `media\d*` covers `media.giphy.com`, `media0.giphy.com` … `media4.giphy.com`.
// Extension is restricted to `.gif` to match the DM payload contract the
// picker emits (the `fixed_width` GIPHY format). If we ever start sending
// animated WebP, both this regex and the send path need to agree.
const GIPHY_URL_REGEX = /\bhttps?:\/\/(?:i|media\d*)\.giphy\.com\/[^\s]+\.gif\b/i;

/**
 * If the DM body is just a GIPHY URL (with optional surrounding
 * whitespace), return the URL so the conversation renderer can inline it
 * as an animated image bubble. Otherwise `null` — the message falls
 * through to plain-text / invoice / location / contact handling.
 */
export function extractGifUrl(text: string): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  const match = trimmed.match(GIPHY_URL_REGEX);
  if (!match) return null;
  // Only treat the message as a GIF card when the URL *is* the whole
  // body. A URL pasted mid-sentence is still a text message the user
  // wrote — don't swallow it into a picture-only bubble.
  if (match[0] !== trimmed) return null;
  return match[0];
}
