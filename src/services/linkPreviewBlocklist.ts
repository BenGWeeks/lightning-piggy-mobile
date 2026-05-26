// Hosts where rendering an OG-preview is either impossible (login wall),
// privacy-sensitive (group invite tokens leak in URL params), or a
// guaranteed waste of bytes (no public OG metadata). Matching is on
// the URL's host; subdomains of a blocklisted root match too.

const BLOCKED_HOSTS: ReadonlyArray<string> = [
  // Slack workspaces — invite URLs (`/T0123/B0123/x/y`) leak workspace +
  // channel IDs in the path; OG fetch logs the IP at Slack as well.
  'slack.com',
  // Discord invite URLs serve OG but redirect chains expose the inviter.
  'discord.com',
  'discord.gg',
  // Telegram joinchat URLs expose the chat token to whoever fetches them.
  't.me',
  // Localhost / mDNS — fetching these from a phone behind NAT either fails
  // or hits a totally unrelated device on the same LAN.
  'localhost',
];

// Suffixes that are always private — we can't enumerate every internal
// host, so match on the trailing label.
const BLOCKED_SUFFIXES: ReadonlyArray<string> = ['.local', '.internal', '.lan'];

function getHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

// Returns true when the URL's host matches an entry on the blocklist.
// Caller (`MessageBubble` / `MessageLinkPreview`) renders nothing extra
// for blocklisted URLs — the bare URL stays clickable in the bubble.
export function isBlocklisted(url: string): boolean {
  const host = getHost(url);
  if (!host) return true;
  for (const blocked of BLOCKED_HOSTS) {
    if (host === blocked) return true;
    if (host.endsWith(`.${blocked}`)) return true;
  }
  for (const suffix of BLOCKED_SUFFIXES) {
    if (host.endsWith(suffix)) return true;
  }
  return false;
}

// Test-only: expose the lists so tests can sanity-check additions
// without re-declaring them.
export const __TEST__ = { BLOCKED_HOSTS, BLOCKED_SUFFIXES };
