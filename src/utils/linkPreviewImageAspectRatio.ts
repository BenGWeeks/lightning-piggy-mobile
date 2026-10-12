export interface LinkPreviewImageSizing {
  aspectRatio: number;
  contentFit: 'cover' | 'contain';
}

const defaultSizing: LinkPreviewImageSizing = { aspectRatio: 1.91, contentFit: 'contain' };
const MAX_CACHED_SIZINGS = 200;
const sizingByUrl = new Map<string, LinkPreviewImageSizing>();

export function getLinkPreviewImageSizing(url: string): LinkPreviewImageSizing {
  const sizing = sizingByUrl.get(url);
  if (!sizing) return defaultSizing;
  // Map insertion order tracks recency; a cache hit moves to the newest end.
  sizingByUrl.delete(url);
  sizingByUrl.set(url, sizing);
  return sizing;
}

export function cacheLinkPreviewImageSizing(
  url: string,
  width: number,
  height: number,
): LinkPreviewImageSizing {
  const ratio = width / height;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isFinite(ratio) ||
    ratio <= 0
  ) {
    return getLinkPreviewImageSizing(url);
  }
  const aspectRatio = Math.min(2.5, Math.max(1, ratio));
  const contentFit = aspectRatio === ratio ? 'cover' : 'contain';
  const previous = getLinkPreviewImageSizing(url);
  if (previous.aspectRatio === aspectRatio && previous.contentFit === contentFit) {
    return storeSizing(url, previous);
  }
  return storeSizing(url, { aspectRatio, contentFit });
}

function storeSizing(url: string, sizing: LinkPreviewImageSizing): LinkPreviewImageSizing {
  sizingByUrl.delete(url);
  sizingByUrl.set(url, sizing);
  if (sizingByUrl.size > MAX_CACHED_SIZINGS) {
    const oldestUrl = sizingByUrl.keys().next().value;
    if (oldestUrl !== undefined) sizingByUrl.delete(oldestUrl);
  }
  return sizing;
}
