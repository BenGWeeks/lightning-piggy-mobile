export interface LinkPreviewImageSizing {
  aspectRatio: number;
  contentFit: 'cover' | 'contain';
}

const defaultSizing: LinkPreviewImageSizing = { aspectRatio: 1.91, contentFit: 'contain' };
const sizingByUrl = new Map<string, LinkPreviewImageSizing>();

export function getLinkPreviewImageSizing(url: string): LinkPreviewImageSizing {
  return sizingByUrl.get(url) ?? defaultSizing;
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
    sizingByUrl.set(url, previous);
    return previous;
  }
  const sizing: LinkPreviewImageSizing = { aspectRatio, contentFit };
  sizingByUrl.set(url, sizing);
  return sizing;
}
