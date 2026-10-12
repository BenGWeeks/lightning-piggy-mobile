import {
  cacheLinkPreviewImageSizing,
  getLinkPreviewImageSizing,
} from './linkPreviewImageAspectRatio';

describe('link preview image sizing', () => {
  it('defaults unknown images to 1.91:1 without cropping', () => {
    expect(getLinkPreviewImageSizing('unknown')).toEqual({
      aspectRatio: 1.91,
      contentFit: 'contain',
    });
  });

  it('evicts the least recently used measurement after 200 entries', () => {
    for (let index = 0; index < 200; index++) {
      cacheLinkPreviewImageSizing(`lru-${index}`, 600, 600);
    }
    // Both reads and writes refresh recency without increasing the size.
    getLinkPreviewImageSizing('lru-0');
    cacheLinkPreviewImageSizing('lru-1', 600, 600);
    cacheLinkPreviewImageSizing('lru-overflow', 600, 600);
    expect(getLinkPreviewImageSizing('lru-2').aspectRatio).toBe(1.91);
    expect(getLinkPreviewImageSizing('lru-0').aspectRatio).toBe(1);
    expect(getLinkPreviewImageSizing('lru-1').aspectRatio).toBe(1);
    expect(getLinkPreviewImageSizing('lru-overflow').aspectRatio).toBe(1);
    cacheLinkPreviewImageSizing('lru-overflow-2', 600, 600);
    expect(getLinkPreviewImageSizing('lru-3').aspectRatio).toBe(1.91);
  });

  it.each([
    [1200, 600, 2, 'cover'],
    [600, 600, 1, 'cover'],
    [1500, 600, 2.5, 'cover'],
    [600, 1200, 1, 'contain'],
    [2400, 600, 2.5, 'contain'],
  ])('sizes %i×%i images to %f with %s', (width, height, aspectRatio, contentFit) => {
    expect(cacheLinkPreviewImageSizing(`dimensions-${width}-${height}`, width, height)).toEqual({
      aspectRatio,
      contentFit,
    });
  });

  it('caches measurements by image URL and reuses unchanged sizing', () => {
    const sizing = cacheLinkPreviewImageSizing('cached', 1200, 600);
    expect(getLinkPreviewImageSizing('cached')).toBe(sizing);
    expect(getLinkPreviewImageSizing('other')).toEqual({
      aspectRatio: 1.91,
      contentFit: 'contain',
    });
    expect(cacheLinkPreviewImageSizing('cached', 600, 300)).toBe(sizing);
    expect(cacheLinkPreviewImageSizing('cached', 600, 600).aspectRatio).toBe(1);
    expect(getLinkPreviewImageSizing('cached').aspectRatio).toBe(1);
  });

  it.each([
    [0, 600],
    [1200, 0],
    [-1, 600],
    [1200, -1],
    [NaN, 600],
    [1200, NaN],
    [Infinity, 600],
    [1200, Infinity],
    [Number.MAX_VALUE, Number.MIN_VALUE],
    [Number.MIN_VALUE, Number.MAX_VALUE],
  ])('ignores invalid dimensions %s×%s without overwriting the cache', (width, height) => {
    expect(cacheLinkPreviewImageSizing('invalid', width, height)).toEqual({
      aspectRatio: 1.91,
      contentFit: 'contain',
    });
    const sizing = cacheLinkPreviewImageSizing('valid-before-invalid', 1200, 600);
    expect(cacheLinkPreviewImageSizing('valid-before-invalid', width, height)).toBe(sizing);
  });
});
