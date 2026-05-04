import { isSupportedImageUrl, __test } from './imageUrl';

describe('isSupportedImageUrl', () => {
  describe('supported extensions', () => {
    it.each(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif'])('allows .%s', (ext) => {
      expect(isSupportedImageUrl(`https://example.com/a.${ext}`)).toBe(true);
    });

    it('is case-insensitive on the extension', () => {
      expect(isSupportedImageUrl('https://example.com/a.JPG')).toBe(true);
      expect(isSupportedImageUrl('https://example.com/a.PnG')).toBe(true);
    });
  });

  describe('unsupported extensions', () => {
    it.each(['svg', 'heic', 'heif', 'ico', 'tif', 'tiff'])(
      'rejects .%s (BitmapFactory cannot decode)',
      (ext) => {
        expect(isSupportedImageUrl(`https://example.com/a.${ext}`)).toBe(false);
      },
    );

    it('rejects uppercase unsupported extensions too', () => {
      expect(isSupportedImageUrl('https://example.com/avatar.SVG')).toBe(false);
      expect(isSupportedImageUrl('https://example.com/photo.HEIC')).toBe(false);
    });
  });

  describe('querystrings + fragments', () => {
    it('strips ?query before reading the extension', () => {
      expect(isSupportedImageUrl('https://cdn.example.com/a.svg?v=1')).toBe(false);
      expect(isSupportedImageUrl('https://cdn.example.com/a.png?v=1')).toBe(true);
    });

    it('strips #fragment before reading the extension', () => {
      expect(isSupportedImageUrl('https://example.com/a.heic#anchor')).toBe(false);
      expect(isSupportedImageUrl('https://example.com/a.webp#anchor')).toBe(true);
    });
  });

  describe('extensionless / unknown URLs (default-allow)', () => {
    it('allows URLs with no extension (CDNs that serve via Content-Type)', () => {
      expect(isSupportedImageUrl('https://api.example.com/u/abc123')).toBe(true);
      expect(isSupportedImageUrl('https://example.com/avatar')).toBe(true);
    });

    it('allows unknown extensions (assume valid until BitmapFactory proves otherwise)', () => {
      expect(isSupportedImageUrl('https://example.com/file.xyz')).toBe(true);
    });
  });

  describe('empty / invalid inputs', () => {
    it('rejects null', () => {
      expect(isSupportedImageUrl(null)).toBe(false);
    });

    it('rejects undefined', () => {
      expect(isSupportedImageUrl(undefined)).toBe(false);
    });

    it('rejects empty string', () => {
      expect(isSupportedImageUrl('')).toBe(false);
    });

    it('rejects whitespace-only string', () => {
      expect(isSupportedImageUrl('   ')).toBe(false);
    });

    it('rejects non-string input', () => {
      // Defensive: callers feeding raw `summary.picture` may have
      // upstream typing slop. The runtime guard keeps the helper
      // crash-free.
      expect(isSupportedImageUrl(42 as unknown as string)).toBe(false);
      expect(isSupportedImageUrl({} as unknown as string)).toBe(false);
    });
  });

  describe('allow + deny lists are disjoint', () => {
    it('no extension appears in both sets', () => {
      for (const ext of __test.SUPPORTED_EXTENSIONS) {
        expect(__test.UNSUPPORTED_EXTENSIONS.has(ext)).toBe(false);
      }
    });
  });
});
