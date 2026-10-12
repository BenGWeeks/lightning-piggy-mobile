// "Is this URL safe for the app to contact AUTOMATICALLY?" (#1338)
//
// The single source of truth for any request the app makes without an
// explicit user tap: link-preview fetches, preview images, chat images, and
// (once #1334 lands) NIP-27 relay hints. A message author controls these
// URLs, so without this check a stranger can make the phone send GET
// requests to devices on the reader's home network (routers, IoT gear) or to
// the phone itself.
//
// Approach: a small STRICT parser, not the platform `URL` class. Classic SSRF
// bypasses live in the gap between the parser that validates a URL and the
// one that fetches it (`127.1`, `0x7f.1`, `2130706433`, `evil.com\@10.0.0.1`,
// percent-encoded or full-width hosts, stray tabs/newlines...). Different
// stacks (WHATWG `URL`, OkHttp, NSURL, bionic `inet_aton`) disagree on those
// forms, so anything outside a narrow, unambiguous grammar is REJECTED rather
// than interpreted:
//   - scheme://host[:port][/?#...] only — no userinfo (`@`), backslash or
//     percent-encoding in the authority, no whitespace / control characters
//     anywhere, ASCII-only authority;
//   - an IPv4 host must be a canonical dotted quad (no shorthand, octal, hex
//     or integer forms), and then a public one;
//   - an IPv6 host must be global unicast (2000::/3) minus special ranges —
//     which by construction excludes ::1, fe80::/10, fc00::/7, ff00::/8,
//     IPv4-mapped / -compatible forms and NAT64;
//   - a hostname must have at least two labels and not end in a private /
//     reserved suffix (`localhost`, `.local`, `.lan`, `.internal`, `.arpa`...).
//
// KNOWN LIMITATION — DNS rebinding: React Native can't resolve DNS before a
// fetch, so a public-looking hostname that RESOLVES to a private address
// (attacker-controlled DNS, or wildcard services like nip.io) can't be fully
// blocked client-side. The mitigation is trust gating: chat media and link
// previews only load automatically for the reader's own messages and people
// they follow (see `src/utils/mediaTrust.ts`); everyone else gets a
// tap-to-load placeholder.
//
// Pure module — no React Native imports — so it's unit-testable and reusable
// from services.

export interface PublicUrlParts {
  /** Lower-case scheme without the colon, e.g. `https`. */
  scheme: string;
  /** Normalised host: lower-case, trailing dot stripped, IPv6 unbracketed. */
  host: string;
  /** Explicit port, or null when the URL relies on the scheme default. */
  port: number | null;
}

/** Default schemes for web content (link previews, images). */
export const HTTP_SCHEMES: readonly string[] = ['http', 'https'];
/** Schemes accepted for relay hints. */
export const RELAY_SCHEMES: readonly string[] = ['wss'];

// Hostname suffixes that only ever resolve inside a private network (or not
// at all). Matched on whole labels: `foo.local` and `local` itself.
const PRIVATE_SUFFIXES: readonly string[] = [
  'localhost', // RFC 6761 — `localhost` and `*.localhost` are loopback
  'local', // mDNS
  'lan',
  'internal',
  'intranet',
  'localdomain',
  'home', // ICANN name-collision TLDs common on home routers
  'corp',
  'arpa', // includes home.arpa (RFC 8375) and reverse-DNS names
  'test', // RFC 6761 reserved
  'invalid',
  'example',
  'onion', // never reachable over clearnet
];

// Public wildcard-DNS services whose names resolve to whatever IP is embedded
// in them (`10.0.0.1.nip.io`). Defence in depth only — anyone can run their
// own such domain, which is exactly the DNS-rebinding limitation above.
const REBINDING_DOMAINS: readonly string[] = [
  'nip.io',
  'sslip.io',
  'xip.io',
  'localtest.me',
  'lvh.me',
];

const SCHEME_RE = /^([a-z][a-z0-9+.-]*):\/\//i;
// Hostname characters we accept: ASCII letters, digits, hyphen, underscore,
// dot. (IDN hosts must arrive in punycode `xn--` form: raw Unicode is rejected
// because IDNA mapping turns full-width digits/dots into ASCII ones.)
const HOSTNAME_RE = /^[a-z0-9._-]+$/;
const LABEL_RE = /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/;
const DECIMAL_RE = /^[0-9]+$/;

/**
 * Parse `url` and return its parts if — and only if — it's safe to contact
 * automatically. Returns null for anything private, local, reserved,
 * ambiguous or malformed. `schemes` defaults to http/https.
 */
export function parsePublicUrl(
  url: string,
  schemes: readonly string[] = HTTP_SCHEMES,
): PublicUrlParts | null {
  if (typeof url !== 'string' || url.length === 0 || url.length > 4096) return null;
  // No whitespace or control characters anywhere: WHATWG silently strips
  // tabs/newlines (`127.0.0.\n1`), other parsers don't.
  for (let i = 0; i < url.length; i++) {
    const c = url.charCodeAt(i);
    if (c <= 0x20 || c === 0x7f) return null;
  }
  const schemeMatch = SCHEME_RE.exec(url);
  if (!schemeMatch) return null;
  const scheme = schemeMatch[1].toLowerCase();
  if (!schemes.includes(scheme)) return null;

  // Authority = everything up to the first `/`, `?` or `#`.
  const rest = url.slice(schemeMatch[0].length);
  const end = rest.search(/[/?#]/);
  const authority = end === -1 ? rest : rest.slice(0, end);
  // Userinfo (`a@b`) and backslashes are where parsers disagree about which
  // part is the host — no legitimate preview needs either.
  if (authority.includes('@') || authority.includes('\\') || authority.includes('%')) return null;
  // Non-ASCII is fine in the path (`/wiki/Köln`) but not in the authority:
  // IDNA maps full-width digits, dots and slashes onto ASCII ones.
  if (!/^[\x21-\x7e]*$/.test(authority)) return null;

  const split = splitHostPort(authority);
  if (!split) return null;
  const host = normalisePublicHost(split.host);
  if (!host) return null;
  return { scheme, host, port: split.port };
}

/** True when `url` is an http(s) URL that's safe to contact automatically. */
export function isPublicHttpUrl(url: string): boolean {
  return parsePublicUrl(url, HTTP_SCHEMES) !== null;
}

/** True when `url` is a wss relay URL that's safe to contact automatically. */
export function isPublicRelayUrl(url: string): boolean {
  return parsePublicUrl(url, RELAY_SCHEMES) !== null;
}

/**
 * Validate a bare host (as it appears in a URL authority — IPv6 may be
 * bracketed). Returns the normalised host when public, otherwise null.
 */
export function normalisePublicHost(rawHost: string): string | null {
  if (!rawHost) return null;
  if (rawHost.startsWith('[')) {
    if (!rawHost.endsWith(']')) return null;
    const inner = rawHost.slice(1, -1).toLowerCase();
    const words = parseIpv6(inner);
    return words && isPublicIpv6(words) ? inner : null;
  }
  let host = rawHost.toLowerCase();
  // One trailing dot is the DNS root (`localhost.` == `localhost`).
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (!host || host.length > 253 || !HOSTNAME_RE.test(host)) return null;
  const labels = host.split('.');
  if (labels.some((l) => l.length === 0)) return null;

  // WHATWG's rule: a host whose LAST label is numeric (decimal or 0x-hex) is
  // an IPv4 address. Accept only the canonical dotted quad; every other
  // numeric form (`127.1`, `2130706433`, `0x7f.1`, `0177.0.0.1`, `1.2.3.4.5`)
  // is interpreted differently by different stacks, so reject it outright.
  const last = labels[labels.length - 1];
  if (DECIMAL_RE.test(last) || /^0x[0-9a-f]*$/.test(last)) {
    const octets = parseCanonicalIpv4(host);
    return octets && isPublicIpv4(octets) ? host : null;
  }

  // Single-label hosts (`router`, `intranet`) resolve via the LAN's search
  // domain — never public.
  if (labels.length < 2) return null;
  if (!labels.every((l) => LABEL_RE.test(l))) return null;
  if (PRIVATE_SUFFIXES.includes(last)) return null;
  for (const d of REBINDING_DOMAINS) {
    if (host === d || host.endsWith(`.${d}`)) return null;
  }
  return host;
}

function splitHostPort(authority: string): { host: string; port: number | null } | null {
  let host: string;
  let portStr: string | null = null;
  if (authority.startsWith('[')) {
    const close = authority.indexOf(']');
    if (close === -1) return null;
    host = authority.slice(0, close + 1);
    const after = authority.slice(close + 1);
    if (after) {
      if (!after.startsWith(':')) return null;
      portStr = after.slice(1);
    }
  } else {
    const colon = authority.indexOf(':');
    if (colon === -1) {
      host = authority;
    } else {
      host = authority.slice(0, colon);
      portStr = authority.slice(colon + 1);
    }
  }
  if (!host) return null;
  if (portStr === null || portStr === '') return { host, port: null };
  if (!DECIMAL_RE.test(portStr) || portStr.length > 5) return null;
  const port = Number(portStr);
  if (port < 1 || port > 65535) return null;
  return { host, port };
}

/** Canonical dotted quad only: 4 decimal octets, 0-255, no leading zeros. */
export function parseCanonicalIpv4(host: string): number[] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!DECIMAL_RE.test(p) || p.length > 3) return null;
    if (p.length > 1 && p.startsWith('0')) return null; // octal ambiguity
    const n = Number(p);
    if (n > 255) return null;
    out.push(n);
  }
  return out;
}

/** IANA special-purpose IPv4 ranges (RFC 6890 + updates) are not public. */
export function isPublicIpv4([a, b, c]: number[]): boolean {
  if (a === 0) return false; // 0.0.0.0/8 "this network"
  if (a === 10) return false; // 10/8 private
  if (a === 100 && b >= 64 && b <= 127) return false; // 100.64/10 CGNAT
  if (a === 127) return false; // loopback
  if (a === 169 && b === 254) return false; // link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return false; // 172.16/12 private
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // IETF / TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return false; // 6to4 relay anycast
  if (a === 192 && b === 168) return false; // 192.168/16 private
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false; // TEST-NET-3
  if (a >= 224) return false; // multicast 224/4, reserved 240/4, broadcast
  return true;
}

/**
 * Parse an (unbracketed) IPv6 address into 8 16-bit words. Supports `::`
 * compression and a trailing dotted-quad. Rejects zone ids and anything
 * non-canonical enough to be ambiguous.
 */
export function parseIpv6(text: string): number[] | null {
  if (!text || !/^[0-9a-f:.]+$/.test(text)) return null;
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parseSide = (side: string): number[] | null => {
    if (side === '') return [];
    const groups = side.split(':');
    const words: number[] = [];
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      if (g.includes('.')) {
        // Embedded IPv4 is only valid as the final group.
        if (i !== groups.length - 1) return null;
        const v4 = parseCanonicalIpv4(g);
        if (!v4) return null;
        words.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
        words.push(parseInt(g, 16));
      }
    }
    return words;
  };
  const head = parseSide(halves[0]);
  if (!head) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const tail = parseSide(halves[1]);
  if (!tail) return null;
  // An embedded IPv4 must be at the very end, not before the `::`.
  if (halves[0].includes('.')) return null;
  const fill = 8 - head.length - tail.length;
  if (fill < 1) return null;
  return [...head, ...new Array<number>(fill).fill(0), ...tail];
}

/**
 * Allow-list: only global unicast (2000::/3), minus the special-purpose
 * blocks inside it. Everything outside 2000::/3 — ::, ::1, ::ffff:0:0/96
 * (IPv4-mapped), ::/96 (IPv4-compatible), 64:ff9b::/96 (NAT64), fc00::/7
 * (ULA), fe80::/10 (link-local), fec0::/10, ff00::/8 (multicast) — is
 * rejected by construction.
 */
export function isPublicIpv6(words: number[]): boolean {
  const [w0, w1] = words;
  if ((w0 & 0xe000) !== 0x2000) return false;
  if (w0 === 0x2001 && w1 < 0x0200) return false; // 2001::/23 IETF (Teredo, benchmarking, ORCHID)
  if (w0 === 0x2001 && w1 === 0x0db8) return false; // documentation
  if (w0 === 0x2002) return false; // 6to4 — embeds an arbitrary IPv4
  if (w0 === 0x3fff && w1 < 0x1000) return false; // 3fff::/20 documentation (RFC 9637)
  return true;
}
