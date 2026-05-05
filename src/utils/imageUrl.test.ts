import { isSupportedImageUrl, __test } from './imageUrl';

// Tests the platform-specific filter — `__test.UNSUPPORTED_EXTENSIONS`
// is the resolved set for the current Platform.OS at module load.
// jest-expo's default Platform.OS is 'ios', so the IOS_UNSUPPORTED set
// (svg + ico) is what's actually rejected by the helper here. The
// per-platform sets are also exposed via __test for direct assertion.

describe('isSupportedImageUrl', () => {
  describe('always-supported extensions (every platform allows these)', () => {
    it.each(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif'])('allows .%s', (ext) => {
      expect(isSupportedImageUrl(`https://example.com/a.${ext}`)).toBe(true);
    });

    it('is case-insensitive on the extension', () => {
      expect(isSupportedImageUrl('https://example.com/a.JPG')).toBe(true);
      expect(isSupportedImageUrl('https://example.com/a.PnG')).toBe(true);
    });
  });

  describe('current-platform deny list', () => {
    it.each([...__test.UNSUPPORTED_EXTENSIONS])(
      'rejects .%s (current platform deny list)',
      (ext) => {
        expect(isSupportedImageUrl(`https://example.com/a.${ext}`)).toBe(false);
      },
    );

    it('rejects uppercase deny-listed extensions too', () => {
      // svg + ico are denied on every platform
      expect(isSupportedImageUrl('https://example.com/avatar.SVG')).toBe(false);
      expect(isSupportedImageUrl('https://example.com/favicon.ICO')).toBe(false);
    });
  });

  describe('per-platform sets', () => {
    it('Android denies HEIC/HEIF/TIFF/TIF on top of svg/ico', () => {
      expect(__test.ANDROID_UNSUPPORTED.has('svg')).toBe(true);
      expect(__test.ANDROID_UNSUPPORTED.has('ico')).toBe(true);
      expect(__test.ANDROID_UNSUPPORTED.has('heic')).toBe(true);
      expect(__test.ANDROID_UNSUPPORTED.has('heif')).toBe(true);
      expect(__test.ANDROID_UNSUPPORTED.has('tif')).toBe(true);
      expect(__test.ANDROID_UNSUPPORTED.has('tiff')).toBe(true);
    });

    it('iOS denies only svg + ico (UIImage handles HEIC/HEIF/TIFF natively)', () => {
      expect(__test.IOS_UNSUPPORTED.has('svg')).toBe(true);
      expect(__test.IOS_UNSUPPORTED.has('ico')).toBe(true);
      expect(__test.IOS_UNSUPPORTED.has('heic')).toBe(false);
      expect(__test.IOS_UNSUPPORTED.has('heif')).toBe(false);
      expect(__test.IOS_UNSUPPORTED.has('tiff')).toBe(false);
    });

    it('iOS deny list is a subset of Android', () => {
      for (const ext of __test.IOS_UNSUPPORTED) {
        expect(__test.ANDROID_UNSUPPORTED.has(ext)).toBe(true);
      }
    });
  });

  describe('querystrings + fragments', () => {
    it('strips ?query before reading the extension', () => {
      expect(isSupportedImageUrl('https://cdn.example.com/a.svg?v=1')).toBe(false);
      expect(isSupportedImageUrl('https://cdn.example.com/a.png?v=1')).toBe(true);
    });

    it('strips #fragment before reading the extension', () => {
      expect(isSupportedImageUrl('https://example.com/a.svg#anchor')).toBe(false);
      expect(isSupportedImageUrl('https://example.com/a.webp#anchor')).toBe(true);
    });
  });

  describe('extensionless / unknown URLs (default-allow)', () => {
    it('allows URLs with no extension (CDNs that serve via Content-Type)', () => {
      expect(isSupportedImageUrl('https://api.example.com/u/abc123')).toBe(true);
      expect(isSupportedImageUrl('https://example.com/avatar')).toBe(true);
    });

    it('allows unknown extensions (assume valid until the native decoder proves otherwise)', () => {
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
      // Defensive: callers feeding raw `summary.picture` may have upstream typing slop. The runtime guard keeps the helper crash-free.
      expect(isSupportedImageUrl(42 as unknown as string)).toBe(false);
      expect(isSupportedImageUrl({} as unknown as string)).toBe(false);
    });
  });
});
