import * as nip19 from 'nostr-tools/nip19';
import { groupContentBlocks } from './nostrContentBlocks';
import { parseNostrContent } from './nip27';

const PK = 'a'.repeat(64);
const note = (c: string) => nip19.noteEncode(c.repeat(64));
const npub = nip19.npubEncode(PK);
const blocks = (s: string, limits?: { maxEmbeds: number; maxMedia: number }) =>
  groupContentBlocks(parseNostrContent(s), limits);

describe('groupContentBlocks', () => {
  it('keeps text and mentions in one inline paragraph', () => {
    const out = blocks(`hey nostr:${npub} how are you`);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('inline');
  });

  it('puts an embedded note on its own card between trimmed paragraphs', () => {
    const out = blocks(`look at this:\n\nnostr:${note('1')}\n\nso true`);
    expect(out.map((b) => b.type)).toEqual(['inline', 'embed', 'inline']);
    expect(out[0]).toEqual({ type: 'inline', tokens: [{ type: 'text', text: 'look at this:' }] });
    expect(out[2]).toEqual({ type: 'inline', tokens: [{ type: 'text', text: 'so true' }] });
  });

  it('groups consecutive pictures separated by whitespace into one row', () => {
    const out = blocks('https://x.example/1.jpg\nhttps://x.example/2.png https://x.example/3.mp4');
    expect(out).toHaveLength(1);
    expect(out[0].type === 'media' && out[0].items.map((m) => m.type)).toEqual([
      'image',
      'image',
      'video',
    ]);
  });

  it('starts a new row when text separates pictures', () => {
    const out = blocks('https://x.example/1.jpg caption https://x.example/2.jpg');
    expect(out.map((b) => b.type)).toEqual(['media', 'inline', 'media']);
  });

  it('degrades references past the embed / media caps to links', () => {
    const out = blocks(
      `nostr:${note('1')} nostr:${note('2')} https://x.example/1.jpg https://x.example/2.jpg`,
      { maxEmbeds: 1, maxMedia: 1 },
    );
    expect(out.map((b) => b.type)).toEqual(['embed', 'inline', 'media', 'inline']);
    const links = out
      .flatMap((b) => (b.type === 'inline' ? b.tokens : []))
      .filter((t) => t.type === 'link');
    expect(links.map((l) => (l.type === 'link' ? l.url : ''))).toEqual([
      `https://njump.me/${note('2')}`,
      'https://x.example/2.jpg',
    ]);
  });

  it('returns nothing for whitespace-only content', () => {
    expect(blocks('  \n ')).toEqual([]);
  });
});
