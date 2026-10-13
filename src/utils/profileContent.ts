// Kind-0 (profile metadata) content parsing. Pure, so it's unit-testable
// without the relay pool. Extracted from nostrService (#703 size cap).
import { validateProfileMetadata } from './profileMetadata';

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
    const data = validateProfileMetadata(JSON.parse(content));
    return {
      name: data.name ?? null,
      displayName: data.displayName ?? null,
      picture: data.picture ?? null,
      banner: data.banner ?? null,
      about: data.about ?? null,
      lud16: data.lud16 ?? null,
      nip05: data.nip05 ?? null,
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
