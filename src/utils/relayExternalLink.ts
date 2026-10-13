import { decode } from 'nostr-tools/nip19';

/** Optional relay metadata is untrusted. Only explicit external-link schemes. */
export function relayExternalLink(value?: string): string | null {
  if (!value) return null;
  const url = value.trim();
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' && parsed.hostname && !parsed.username && !parsed.password)
      return url;
    if (parsed.protocol === 'mailto:' && /^[^\s@]+@[^\s@]+$/.test(parsed.pathname)) return url;
    if (parsed.protocol === 'nostr:') {
      const decoded = decode(parsed.pathname);
      if (['npub', 'nprofile', 'note', 'nevent', 'naddr'].includes(decoded.type)) return url;
    }
  } catch {
    /* malformed optional metadata */
  }
  // NIP-11 contact is commonly a bare email address.
  if (/^[^\s:@]+@[^\s@]+\.[^\s@]+$/.test(url)) return `mailto:${url}`;
  // Some NIP-11 contacts (including Primal) publish a bare website host.
  if (/^(?:[a-z0-9-]+\.)+[a-z]{2,63}(?:[/?#][^\s]*)?$/i.test(url))
    return relayExternalLink(`https://${url}`);
  return null;
}
