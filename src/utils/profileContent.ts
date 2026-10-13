// Kind-0 (profile metadata) content parsing. Pure, so it's unit-testable
// without the relay pool. Extracted from nostrService (#703 size cap).
import { isPublicHttpUrl } from './publicUrl';

/** A kind-0 image URL, kept only when it's a public http(s) address (#1338). */
function publicImageUrl(value: unknown): string | null {
  return typeof value === 'string' && isPublicHttpUrl(value) ? value : null;
}

/** Signatures authenticate the author, not the types inside kind-0 JSON. */
function profileText(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

export function parseProfileContent(content: string): {
  name: string | null;
  displayName: string | null;
  picture: string | null;
  banner: string | null;
  about: string | null;
  lud16: string | null;
  nip05: string | null;
} {
  try {
    const data = JSON.parse(content);
    return {
      name: profileText(data.name),
      displayName: profileText(data.display_name),
      // Avatars and banners load automatically all over the app, so a kind-0
      // can't point them at a private / local address (#1338).
      picture: publicImageUrl(data.picture),
      banner: publicImageUrl(data.banner),
      about: profileText(data.about),
      lud16: profileText(data.lud16),
      nip05: profileText(data.nip05),
    };
  } catch {
    return {
      name: null,
      displayName: null,
      picture: null,
      banner: null,
      about: null,
      lud16: null,
      nip05: null,
    };
  }
}
