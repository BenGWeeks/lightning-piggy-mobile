/**
 * URL-extension allow/deny lists used by the avatar-rendering layer to
 * suppress Android's BitmapFactory `unimplemented` decode flood (issue
 * #189). When ~50 contacts in a list each hand `expo-image` a URL whose
 * format Glide can't decode (e.g. `.svg`, `.heic`, `.tif`), Android logs
 * a `--- Failed to create image decoder with message 'unimplemented'`
 * line plus a full Java stack trace per row. The thrown objects
 * triggered ~400 ms GC clusters during scrolling.
 *
 * The pre-flight URL filter is deliberately conservative: it only
 * rejects extensions we KNOW the native decoder can't handle. URLs
 * without an extension, or with an unrecognised extension (e.g.
 * `?fm=auto` querystrings on a CDN), default to allowed — most CDN
 * URLs work fine and we don't want to silently swap valid avatars for
 * the initials fallback.
 */

const SUPPORTED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif']);

const UNSUPPORTED_EXTENSIONS = new Set(['svg', 'heic', 'heif', 'ico', 'tif', 'tiff']);

/**
 * Returns false for URLs whose extension is on the deny list (we know
 * Android's BitmapFactory can't decode them); true for everything
 * else, including URLs with no extension or an unrecognised one.
 *
 * Empty / null / non-string inputs return false so callers can feed
 * `summary.picture` directly without a separate truthy check.
 */
export function isSupportedImageUrl(url: string | null | undefined): boolean {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (trimmed.length === 0) return false;

  // Strip query string + fragment before pulling the extension —
  // `https://cdn.example.com/avatar.svg?cache=1` should still be read
  // as `.svg`, not `.svg?cache=1`.
  const withoutQuery = trimmed.split(/[?#]/, 1)[0]!;
  const lastDot = withoutQuery.lastIndexOf('.');
  if (lastDot === -1) {
    // No extension at all — allow. Many CDN avatar URLs are extension-
    // less (`https://api.example.com/u/abc123`) and resolve to a JPEG
    // via the Content-Type header. We can't know without a HEAD, and
    // we're optimising for the false-positive cost (silently dropping
    // a valid avatar), not the false-negative cost (one log line).
    return true;
  }

  const ext = withoutQuery.slice(lastDot + 1).toLowerCase();
  if (UNSUPPORTED_EXTENSIONS.has(ext)) return false;

  // Default-allow: explicit allow-list match OR unknown extension.
  // `SUPPORTED_EXTENSIONS` is exported so tests + future call sites can
  // reason about which extensions are guaranteed-good vs merely
  // not-known-bad.
  return SUPPORTED_EXTENSIONS.has(ext) || true;
}

export const __test = { SUPPORTED_EXTENSIONS, UNSUPPORTED_EXTENSIONS };
