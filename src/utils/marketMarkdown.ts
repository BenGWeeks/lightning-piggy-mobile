// Markdown for Market listing descriptions (#1273). NIP-99 (and so the Gamma
// Markets spec) defines a listing's `content` as Markdown. PURE: turns the
// text into a small, render-ready block/inline model that MarkdownText maps
// onto React Native <Text>/<View>.
//
// Parsing uses `marked`'s lexer only (pure JS, no HTML output). The model is
// a deliberately SAFE SUBSET: paragraphs and line breaks, bold / italic /
// strikethrough, headings (1-3), bullet and numbered lists, block quotes,
// inline code and code blocks, and https links. Raw HTML is dropped (its
// text is not rendered), images are skipped, and a link is only tappable
// when it's https with no credentials — anything else renders as text.
import { Lexer, type Token, type Tokens } from 'marked';
import { safeMarketUrl } from './marketListings';

export interface MdInline {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  /** Present only for a safe https link. */
  href?: string;
}

export type MdBlock =
  | { type: 'paragraph'; inlines: MdInline[] }
  | { type: 'heading'; level: 1 | 2 | 3; inlines: MdInline[] }
  | { type: 'list'; ordered: boolean; start: number; items: MdBlock[][] }
  | { type: 'quote'; blocks: MdBlock[] }
  | { type: 'code'; text: string };

/** Hard cap on what we lex — descriptions are already capped upstream. */
const MAX_INPUT_CHARS = 20000;
/** Nesting cap so a hostile "> > > > …" or deep list can't blow the stack. */
const MAX_DEPTH = 6;

type Style = Omit<MdInline, 'text'>;

function inlines(tokens: Token[] | undefined, style: Style, out: MdInline[], depth: number) {
  if (!tokens || depth > MAX_DEPTH * 2) return out;
  for (const token of tokens) {
    switch (token.type) {
      case 'text':
      case 'escape': {
        const t = token as Tokens.Text;
        if (t.tokens && t.tokens.length > 0) inlines(t.tokens, style, out, depth + 1);
        else if (t.text) out.push({ ...style, text: decodeEntities(t.text) });
        break;
      }
      case 'strong':
        inlines((token as Tokens.Strong).tokens, { ...style, bold: true }, out, depth + 1);
        break;
      case 'em':
        inlines((token as Tokens.Em).tokens, { ...style, italic: true }, out, depth + 1);
        break;
      case 'del':
        inlines((token as Tokens.Del).tokens, { ...style, strike: true }, out, depth + 1);
        break;
      case 'codespan':
        out.push({ ...style, code: true, text: decodeEntities((token as Tokens.Codespan).text) });
        break;
      case 'br':
        out.push({ ...style, text: '\n' });
        break;
      case 'link': {
        const link = token as Tokens.Link;
        const href = safeMarketUrl(link.href) ?? undefined;
        inlines(link.tokens, href ? { ...style, href } : style, out, depth + 1);
        break;
      }
      // Raw HTML and images are outside the safe subset.
      case 'html':
      case 'image':
        break;
      default: {
        const raw = (token as { text?: unknown }).text;
        if (typeof raw === 'string' && raw) out.push({ ...style, text: decodeEntities(raw) });
      }
    }
  }
  return out;
}

/** Merge neighbouring runs with identical styling (fewer <Text> nodes). */
function compact(runs: MdInline[]): MdInline[] {
  const out: MdInline[] = [];
  for (const run of runs) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.bold === run.bold &&
      prev.italic === run.italic &&
      prev.strike === run.strike &&
      prev.code === run.code &&
      prev.href === run.href
    ) {
      prev.text += run.text;
    } else out.push({ ...run });
  }
  return out;
}

function blocks(tokens: Token[], depth: number): MdBlock[] {
  const out: MdBlock[] = [];
  if (depth > MAX_DEPTH) return out;
  for (const token of tokens) {
    switch (token.type) {
      case 'paragraph':
      case 'text': {
        const t = token as Tokens.Paragraph | Tokens.Text;
        const runs = compact(
          inlines(t.tokens ?? [{ type: 'text', raw: t.raw, text: t.text } as Token], {}, [], 0),
        );
        if (runs.some((r) => r.text.trim())) out.push({ type: 'paragraph', inlines: runs });
        break;
      }
      case 'heading': {
        const h = token as Tokens.Heading;
        const runs = compact(inlines(h.tokens, {}, [], 0));
        if (runs.length > 0)
          out.push({
            type: 'heading',
            level: Math.min(3, Math.max(1, h.depth)) as 1 | 2 | 3,
            inlines: runs,
          });
        break;
      }
      case 'list': {
        const list = token as Tokens.List;
        const items = list.items
          .map((item) => blocks(item.tokens, depth + 1))
          .filter((item) => item.length > 0);
        if (items.length > 0)
          out.push({
            type: 'list',
            ordered: list.ordered,
            start: typeof list.start === 'number' ? list.start : 1,
            items,
          });
        break;
      }
      case 'blockquote': {
        const inner = blocks((token as Tokens.Blockquote).tokens, depth + 1);
        if (inner.length > 0) out.push({ type: 'quote', blocks: inner });
        break;
      }
      case 'code':
        if ((token as Tokens.Code).text.trim())
          out.push({ type: 'code', text: (token as Tokens.Code).text });
        break;
      case 'table': {
        // Tables aren't in the subset: keep their text, one row per line.
        const table = token as Tokens.Table;
        const rows = [table.header, ...table.rows].map((row) =>
          row.map((cell) => cell.text).join(' · '),
        );
        out.push({ type: 'paragraph', inlines: [{ text: decodeEntities(rows.join('\n')) }] });
        break;
      }
      // html, hr, space, def: nothing to render.
      default:
        break;
    }
  }
  return out;
}

/** Parse a listing description into the safe render model. */
export function parseMarkdown(markdown: string): MdBlock[] {
  if (!markdown || !markdown.trim()) return [];
  try {
    const tokens = new Lexer({ gfm: true, breaks: true }).lex(markdown.slice(0, MAX_INPUT_CHARS));
    return blocks(tokens, 0);
  } catch {
    // Never let a lexer edge case blank the description.
    return [{ type: 'paragraph', inlines: [{ text: markdown.slice(0, MAX_INPUT_CHARS) }] }];
  }
}

const textLength = (block: MdBlock): number => {
  switch (block.type) {
    case 'paragraph':
    case 'heading':
      return block.inlines.reduce((n, r) => n + r.text.length, 0);
    case 'code':
      return block.text.length;
    case 'quote':
      return block.blocks.reduce((n, b) => n + textLength(b), 0);
    case 'list':
      return block.items.reduce((n, item) => n + item.reduce((m, b) => m + textLength(b), 0), 0);
  }
};

/**
 * The leading blocks that fit `maxChars` of text (always at least one), for
 * a collapsed "Show more" view. Whole blocks only — never a cut mid-link.
 */
export function truncateBlocks(
  all: MdBlock[],
  maxChars: number,
): { blocks: MdBlock[]; truncated: boolean } {
  let used = 0;
  let count = 0;
  for (const block of all) {
    const len = textLength(block);
    if (count > 0 && used + len > maxChars) break;
    used += len;
    count++;
  }
  return { blocks: all.slice(0, count), truncated: count < all.length };
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

/** marked escapes a few characters in token text; undo the common ones. */
function decodeEntities(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m);
}
