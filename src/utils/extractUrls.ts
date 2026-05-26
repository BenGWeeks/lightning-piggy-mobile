// Extracts every distinct HTTP(S) URL from a block of text.
// Used to drive the per-message link-preview card in MessageBubble (#441).
// HTTP/HTTPS only — `mailto:`, `nostr:`, `lightning:`, `bitcoin:` are
// handled by other rich-content paths (NIP-21 contact card, invoice card, etc).

// Matches the URL itself loosely; trailing punctuation and balanced
// parens are normalised by stripTrailingPunctuation below. We deliberately
// do not anchor word-boundaries on the start because some links arrive
// surrounded by markdown like `[label](https://x)`.
const URL_REGEX = /https?:\/\/[^\s<>"'`]+/gi;

// Punctuation we strip from the tail of a captured URL. Mirrors the
// behaviour of common URL-extraction libs (linkify-it, autolinker) — a
// URL at the end of a sentence shouldn't include the period.
const TRAILING_PUNCT = /[.,;:!?\]}>'"`]+$/;

function stripTrailingPunctuation(url: string): string {
  let out = url;
  // Repeatedly strip until stable — `…foo).` should peel `.` then `)`.
  // Stop when the URL ends in something that's clearly part of it.
  while (true) {
    const stripped = out.replace(TRAILING_PUNCT, '');
    if (stripped === out) break;
    out = stripped;
  }
  // Balance unmatched closing parens — wikipedia-style links have `)` in
  // them, but if there's no matching `(` the trailing one isn't ours.
  while (out.endsWith(')')) {
    const opens = (out.match(/\(/g) || []).length;
    const closes = (out.match(/\)/g) || []).length;
    if (closes <= opens) break;
    out = out.slice(0, -1);
  }
  return out;
}

// Returns every distinct HTTP(S) URL in `text`, in first-seen order.
// Order preservation matters because MessageBubble renders the first
// non-blocklisted URL — we don't want surprise reordering.
export function extractUrls(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const matches = text.match(URL_REGEX);
  if (!matches) return out;
  for (const raw of matches) {
    const cleaned = stripTrailingPunctuation(raw);
    if (!cleaned) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}
