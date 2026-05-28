// Split message text into plain + URL segments so a chat bubble can render
// http(s) links as tappable spans while leaving the surrounding text plain
// (#663). Kept as a pure helper under src/utils so it's unit-testable.

export interface LinkSegment {
  text: string;
  // Present iff this segment is a tappable URL. `text` is what to display
  // (identical to the URL), `url` is what to open.
  url?: string;
}

// http(s) URLs, greedy up to the next whitespace. Trailing punctuation is
// peeled off separately below so a sentence-ending ")"/"." isn't swallowed.
const URL_RE = /https?:\/\/[^\s]+/gi;

// Punctuation that's almost always sentence/markup rather than part of the URL
// when it sits at the very end of the match.
const TRAILING_PUNCT = /[.,;:!?)\]}'"»]+$/;

export function linkifySegments(input: string): LinkSegment[] {
  const segments: LinkSegment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(input)) !== null) {
    let url = m[0];
    let trailing = '';
    const tm = url.match(TRAILING_PUNCT);
    if (tm) {
      trailing = tm[0];
      url = url.slice(0, url.length - trailing.length);
    }
    // Degenerate match that was ALL punctuation after the scheme — skip.
    if (url.length <= 'https://'.length) continue;
    if (m.index > last) segments.push({ text: input.slice(last, m.index) });
    segments.push({ text: url, url });
    if (trailing) segments.push({ text: trailing });
    last = m.index + m[0].length;
  }
  if (last < input.length) segments.push({ text: input.slice(last) });
  // Always return at least one segment so callers can map unconditionally.
  if (segments.length === 0) segments.push({ text: input });
  return segments;
}

// True when the text contains at least one linkable URL — lets callers skip
// the segment map entirely for the common no-URL message.
export function hasLink(input: string): boolean {
  URL_RE.lastIndex = 0;
  return URL_RE.test(input);
}
