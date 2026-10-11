// NIP-27 content parser: splits a note / bio / message body into renderable
// tokens. `nostr:` references (NIP-21 URIs carrying a NIP-19 entity) become
// profile / event / address tokens, http(s) URLs become image / video / link
// tokens, and everything else stays text. Pure — no React, no I/O — so the
// renderer (`components/nostr/NostrContent`) and future chat surfaces (#1295)
// share one tested tokenizer.
import * as nip19 from 'nostr-tools/nip19';
import { classifyMediaUrl } from './noteMedia';

export type NostrContentToken =
  | { type: 'text'; text: string }
  | { type: 'profile'; pubkey: string; relays: string[]; raw: string }
  | {
      type: 'event';
      id: string;
      relays: string[];
      author?: string;
      kind?: number;
      raw: string;
    }
  | {
      type: 'address';
      kind: number;
      pubkey: string;
      identifier: string;
      relays: string[];
      raw: string;
    }
  | { type: 'image'; url: string }
  | { type: 'video'; url: string }
  | { type: 'link'; url: string };

export type NostrEntityToken = Extract<
  NostrContentToken,
  { type: 'profile' | 'event' | 'address' }
>;

// bech32 data charset (BIP-173) — no 1, b, i, o.
const BECH32 = '[02-9ac-hj-np-z]';
// `nostr:` is optional: plenty of clients (and bios) paste a bare `npub1…`.
// A bare match must start at a word boundary so `xnpub1…` inside some other
// token isn't claimed; the checksum in `nip19.decode` rejects anything that
// merely looks like bech32. NIP-19 entities are lower-case, the scheme is
// case-insensitive (NIP-21).
// The per-character lookahead stops a body at a following `nostr:` so two
// references written back-to-back still split.
const ENTITY = `(?:nostr:|(?<![\\w/:]))(?:npub|nprofile|note|nevent|naddr)1(?:(?!nostr:)${BECH32}){6,}`;
const URL = `https?:\\/\\/[^\\s<>"'\\u00a0]+`;
const TOKEN_RE = new RegExp(`(${URL})|(${ENTITY})`, 'gi');

// Punctuation that commonly trails a URL in prose but is rarely part of it.
const TRAILING_PUNCT_RE = /[.,;:!?'"’”)\]}>]+$/;

/** Relay hints are untrusted text from the event — keep only ws(s) URLs. */
function cleanRelays(relays: string[] | undefined): string[] {
  if (!Array.isArray(relays)) return [];
  return relays.filter((r) => typeof r === 'string' && /^wss?:\/\/\S+$/i.test(r)).slice(0, 5);
}

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Decode one NIP-19 entity (with or without `nostr:`). Returns null for
 * malformed / bad-checksum input and for entity types we don't render
 * (`nsec` — never surfaced, `nrelay` — deprecated).
 */
export function decodeNostrEntity(raw: string): NostrEntityToken | null {
  const bech = raw.replace(/^nostr:/i, '').toLowerCase();
  // Only lower-case input is valid NIP-19; an all-caps bech32 is legal per
  // BIP-173 but nobody writes it, and mixed case is invalid.
  if (raw.replace(/^nostr:/i, '') !== bech) return null;
  let decoded: ReturnType<typeof nip19.decode>;
  try {
    decoded = nip19.decode(bech);
  } catch {
    return null;
  }
  switch (decoded.type) {
    case 'npub':
      return HEX64.test(decoded.data)
        ? { type: 'profile', pubkey: decoded.data, relays: [], raw }
        : null;
    case 'nprofile':
      return HEX64.test(decoded.data.pubkey)
        ? {
            type: 'profile',
            pubkey: decoded.data.pubkey,
            relays: cleanRelays(decoded.data.relays),
            raw,
          }
        : null;
    case 'note':
      return HEX64.test(decoded.data) ? { type: 'event', id: decoded.data, relays: [], raw } : null;
    case 'nevent': {
      const { id, relays, author, kind } = decoded.data;
      if (!HEX64.test(id)) return null;
      return {
        type: 'event',
        id,
        relays: cleanRelays(relays),
        author: author && HEX64.test(author) ? author : undefined,
        kind: typeof kind === 'number' ? kind : undefined,
        raw,
      };
    }
    case 'naddr': {
      const { identifier, pubkey, kind, relays } = decoded.data;
      if (!HEX64.test(pubkey) || typeof kind !== 'number') return null;
      return { type: 'address', kind, pubkey, identifier, relays: cleanRelays(relays), raw };
    }
    default:
      return null;
  }
}

function pushText(tokens: NostrContentToken[], text: string): void {
  if (!text) return;
  const last = tokens[tokens.length - 1];
  if (last && last.type === 'text') last.text += text;
  else tokens.push({ type: 'text', text });
}

/**
 * Tokenize `content`. Adjacent text is merged; malformed references stay
 * text verbatim, so nothing the author wrote is ever dropped.
 */
export function parseNostrContent(content: string): NostrContentToken[] {
  const tokens: NostrContentToken[] = [];
  if (typeof content !== 'string' || content.length === 0) return tokens;
  let cursor = 0;
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(content)) !== null) {
    const start = match.index;
    const full = match[0];
    if (match[1]) {
      // URL — peel trailing prose punctuation back into the text stream, but
      // keep a closing paren when the URL itself opened one (Wikipedia-style).
      let url = full;
      const trail = url.match(TRAILING_PUNCT_RE)?.[0] ?? '';
      if (trail) {
        let keep = '';
        if (trail.startsWith(')') && url.includes('(')) keep = ')';
        url = url.slice(0, url.length - trail.length) + keep;
      }
      pushText(tokens, content.slice(cursor, start));
      const media = classifyMediaUrl(url);
      tokens.push(
        media === 'image'
          ? { type: 'image', url }
          : media === 'video'
            ? { type: 'video', url }
            : { type: 'link', url },
      );
      cursor = start + url.length;
      TOKEN_RE.lastIndex = cursor;
      continue;
    }
    const entity = decodeNostrEntity(full);
    if (!entity) continue; // leave it in the text stream
    let before = content.slice(cursor, start);
    // `@npub1…` — the chip already reads "@Name"; drop the author's own `@`.
    if (entity.type === 'profile' && before.endsWith('@')) before = before.slice(0, -1);
    pushText(tokens, before);
    tokens.push(entity);
    cursor = start + full.length;
  }
  pushText(tokens, content.slice(cursor));
  return tokens;
}

/** Cache key for an event / address reference — shared by the embed cache. */
export function embedKey(token: Extract<NostrContentToken, { type: 'event' | 'address' }>): string {
  return token.type === 'event'
    ? `e:${token.id}`
    : `a:${token.kind}:${token.pubkey}:${token.identifier}`;
}

/** Short `npub1abcd…wxyz` label for a pubkey whose profile isn't known yet. */
export function shortNpubLabel(pubkey: string): string {
  try {
    const npub = nip19.npubEncode(pubkey);
    return `${npub.slice(0, 10)}…${npub.slice(-4)}`;
  } catch {
    return `${pubkey.slice(0, 8)}…`;
  }
}

/**
 * One-line plain-text preview of `content` with references collapsed —
 * profiles to `@npub1…`, embedded events / addresses to a marker — for the
 * compact text inside an embedded card (cards never nest cards).
 */
export function previewText(content: string, eventMarker = '↪'): string {
  return parseNostrContent(content)
    .map((t) => {
      switch (t.type) {
        case 'text':
          return t.text;
        case 'profile':
          return `@${shortNpubLabel(t.pubkey)}`;
        case 'event':
        case 'address':
          return eventMarker;
        default:
          return t.url;
      }
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}
