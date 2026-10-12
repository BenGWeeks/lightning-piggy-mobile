// Hosts where rendering an OG-preview is either impossible (login wall),
// privacy-sensitive (group invite tokens leak in URL params), or a
// guaranteed waste of bytes (no public OG metadata). Matching is on
// the URL's host; subdomains of a blocklisted root match too.
//
// Private / local / reserved addresses (localhost, `.local`, LAN IPs, IPv6
// loopback, numeric shorthand...) are rejected by the shared
// `isPublicHttpUrl` check first (#1338) — this list only covers PUBLIC hosts
// we choose not to preview.
import { parsePublicUrl } from '../utils/publicUrl';
import { extractUrls } from '../utils/extractUrls';

const BLOCKED_HOSTS: readonly string[] = [
  // Slack workspaces — invite URLs (`/T0123/B0123/x/y`) leak workspace +
  // channel IDs in the path; OG fetch logs the IP at Slack as well.
  'slack.com',
  // Discord invite URLs serve OG but redirect chains expose the inviter.
  'discord.com',
  'discord.gg',
  // Telegram joinchat URLs expose the chat token to whoever fetches them.
  't.me',
];

// Returns true when the URL must not be previewed: it isn't a public
// http(s) URL (#1338), or its host is on the blocklist above. Caller
// (`MessageBubble` / `MessageLinkPreview`) renders nothing extra for
// blocklisted URLs — the bare URL stays clickable in the bubble.
export function isBlocklisted(url: string): boolean {
  const parts = parsePublicUrl(url);
  if (!parts) return true;
  for (const blocked of BLOCKED_HOSTS) {
    if (parts.host === blocked) return true;
    if (parts.host.endsWith(`.${blocked}`)) return true;
  }
  return false;
}

// The URL a message's preview card should use: the first one that isn't
// blocklisted (or private), or null. Capped at one preview per message.
export function firstPreviewableUrl(text: string): string | null {
  for (const u of extractUrls(text)) {
    if (!isBlocklisted(u)) return u;
  }
  return null;
}

// Test-only: expose the list so tests can sanity-check additions
// without re-declaring it.
export const __TEST__ = { BLOCKED_HOSTS };
