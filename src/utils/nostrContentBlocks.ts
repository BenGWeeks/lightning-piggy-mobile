// Groups NIP-27 tokens into the blocks `NostrContent` lays out: runs of
// inline content (text, @mentions, links) flow as one paragraph; runs of
// images / videos become one thumbnail row; each embedded note / address is
// its own card. Pure, so the layout rules are unit-tested.
import { shortNpubLabel, type NostrContentToken } from './nip27';

type Inline = Extract<NostrContentToken, { type: 'text' | 'profile' | 'link' }>;
type Media = Extract<NostrContentToken, { type: 'image' | 'video' }>;
type Embed = Extract<NostrContentToken, { type: 'event' | 'address' }>;

export type ContentBlock =
  | { type: 'inline'; tokens: Inline[] }
  | { type: 'media'; items: Media[] }
  | { type: 'embed'; token: Embed };

export interface BlockLimits {
  /** Embedded cards per body; extra references render as inline links. */
  maxEmbeds: number;
  /** Thumbnails per body; extra media render as inline links. */
  maxMedia: number;
  /**
   * @Name chips per body. Each chip resolves a profile, so a note stuffed
   * with hundreds of npubs must not fan out hundreds of lookups; extra
   * mentions render as plain `@npub1…` text.
   */
  maxMentions: number;
}

export const DEFAULT_BLOCK_LIMITS: BlockLimits = { maxEmbeds: 3, maxMedia: 6, maxMentions: 20 };

/** Trim blank lines at a paragraph's edges — the block gap replaces them. */
function trimEdges(tokens: Inline[]): Inline[] {
  const out = tokens.map((t) => ({ ...t }));
  const first = out[0];
  if (first?.type === 'text') first.text = first.text.replace(/^\s+/, '');
  const last = out[out.length - 1];
  if (last?.type === 'text') last.text = last.text.replace(/\s+$/, '');
  return out.filter((t) => t.type !== 'text' || t.text.length > 0);
}

export function groupContentBlocks(
  tokens: readonly NostrContentToken[],
  limits: BlockLimits = DEFAULT_BLOCK_LIMITS,
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  let inline: Inline[] = [];
  let embeds = 0;
  let media = 0;
  let mentions = 0;
  const flushInline = () => {
    const trimmed = trimEdges(inline);
    if (trimmed.length > 0) blocks.push({ type: 'inline', tokens: trimmed });
    inline = [];
  };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'image' || token.type === 'video') {
      if (media >= limits.maxMedia) {
        inline.push({ type: 'link', url: token.url });
        continue;
      }
      media++;
      const prev = blocks[blocks.length - 1];
      // Whitespace between two pictures doesn't break their row.
      const onlySpaceSince = inline.every((t) => t.type === 'text' && t.text.trim() === '');
      if (prev?.type === 'media' && onlySpaceSince) {
        inline = [];
        prev.items.push(token);
      } else {
        flushInline();
        blocks.push({ type: 'media', items: [token] });
      }
      continue;
    }
    if (token.type === 'event' || token.type === 'address') {
      if (embeds >= limits.maxEmbeds) {
        inline.push({ type: 'link', url: `https://njump.me/${token.raw.replace(/^nostr:/i, '')}` });
        continue;
      }
      embeds++;
      flushInline();
      blocks.push({ type: 'embed', token });
      continue;
    }
    if (token.type === 'profile') {
      if (mentions >= limits.maxMentions) {
        inline.push({ type: 'text', text: `@${shortNpubLabel(token.pubkey)}` });
        continue;
      }
      mentions++;
    }
    inline.push(token);
  }
  flushInline();
  return blocks;
}
