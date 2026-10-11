// Media detection for Nostr notes — what goes in a profile's Media grid and
// which URLs render as inline thumbnails. Pure, no I/O.
//
// Sources, in priority order:
//   - NIP-68 picture events (kind 20) and NIP-71 video events (kind 21 / 22):
//     their media lives in `imeta` tags (NIP-92 shape).
//   - kind-1 notes: `imeta` tags (NIP-92) plus bare image / video URLs in the
//     content, recognised by file extension.

export type MediaType = 'image' | 'video';

export interface NoteMediaItem {
  url: string;
  type: MediaType;
  /** Poster / preview image for a video (imeta `image`), when the author gave one. */
  thumb?: string;
  blurhash?: string;
  alt?: string;
}

export interface MediaSourceEvent {
  kind: number;
  content: string;
  tags: string[][];
}

export const PICTURE_KIND = 20;
export const VIDEO_KINDS = [21, 22] as const;
/** Kinds the profile feed asks relays for: notes + picture / video events. */
export const PROFILE_FEED_KINDS = [1, PICTURE_KIND, ...VIDEO_KINDS];

const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|avif|heic|heif|bmp)$/i;
const VIDEO_EXT = /\.(?:mp4|mov|webm|m4v|m3u8)$/i;

function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\/\S+$/i.test(value);
}

/** Path part of a URL (no query / fragment), for extension checks. */
function pathOf(url: string): string {
  return url.split(/[?#]/, 1)[0] ?? url;
}

/** 'image' / 'video' by file extension, or null for anything else. */
export function classifyMediaUrl(url: string): MediaType | null {
  if (!isHttpUrl(url)) return null;
  const path = pathOf(url);
  if (IMAGE_EXT.test(path)) return 'image';
  if (VIDEO_EXT.test(path)) return 'video';
  return null;
}

interface Imeta {
  url: string;
  mime?: string;
  thumb?: string;
  blurhash?: string;
  alt?: string;
}

/**
 * Parse NIP-92 `imeta` tags: `["imeta", "url https://…", "m image/jpeg",
 * "blurhash …", "image https://…thumb"]`. Entries without an http(s) `url`
 * are dropped.
 */
export function parseImetaTags(tags: readonly string[][]): Imeta[] {
  const out: Imeta[] = [];
  if (!Array.isArray(tags)) return out;
  for (const tag of tags) {
    if (!Array.isArray(tag) || tag[0] !== 'imeta') continue;
    const fields: Record<string, string> = {};
    for (const part of tag.slice(1)) {
      if (typeof part !== 'string') continue;
      const space = part.indexOf(' ');
      if (space <= 0) continue;
      const key = part.slice(0, space);
      // First value wins — NIP-92 allows repeats (e.g. several `fallback`s).
      if (!(key in fields)) fields[key] = part.slice(space + 1).trim();
    }
    if (!isHttpUrl(fields.url)) continue;
    out.push({
      url: fields.url,
      mime: fields.m?.toLowerCase(),
      thumb: isHttpUrl(fields.image) ? fields.image : undefined,
      blurhash: fields.blurhash || undefined,
      alt: fields.alt || undefined,
    });
  }
  return out;
}

function imetaType(meta: Imeta): MediaType | null {
  if (meta.mime?.startsWith('image/')) return 'image';
  if (meta.mime?.startsWith('video/')) return 'video';
  return classifyMediaUrl(meta.url);
}

/** All image / video items an event carries, de-duplicated by URL. */
export function extractNoteMedia(event: MediaSourceEvent): NoteMediaItem[] {
  const items: NoteMediaItem[] = [];
  const seen = new Set<string>();
  const add = (item: NoteMediaItem) => {
    if (seen.has(item.url)) return;
    seen.add(item.url);
    items.push(item);
  };
  const isPicture = event.kind === PICTURE_KIND;
  const isVideo = (VIDEO_KINDS as readonly number[]).includes(event.kind);
  for (const meta of parseImetaTags(event.tags)) {
    // A picture / video event's imeta defines its media even without a mime;
    // fall back to the event kind when neither mime nor extension says.
    const type = imetaType(meta) ?? (isPicture ? 'image' : isVideo ? 'video' : null);
    if (!type) continue;
    add({ url: meta.url, type, thumb: meta.thumb, blurhash: meta.blurhash, alt: meta.alt });
  }
  // kind-20/21/22 content is a caption, not media; only notes carry bare URLs.
  if (event.kind === 1 && typeof event.content === 'string') {
    const urls = event.content.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
    for (const raw of urls) {
      const url = raw.replace(/[.,;:!?)\]}>]+$/, '');
      const type = classifyMediaUrl(url);
      if (type) add({ url, type });
    }
  }
  return items;
}

/** True when the event belongs in the Media grid. */
export function hasMedia(event: MediaSourceEvent): boolean {
  return extractNoteMedia(event).length > 0;
}
