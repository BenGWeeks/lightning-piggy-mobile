import * as nip19 from 'nostr-tools/nip19';
import {
  decodeNostrEntity,
  isPublicRelayUrl,
  parseIPv4Literal,
  embedKey,
  parseNostrContent,
  previewText,
  shortNpubLabel,
  type NostrContentToken,
} from './nip27';

const PK = 'a'.repeat(64);
const PK2 = 'b'.repeat(64);
const ID = 'c'.repeat(64);
const npub = nip19.npubEncode(PK);
const nprofile = nip19.nprofileEncode({
  pubkey: PK2,
  relays: ['wss://relay.example', 'javascript:alert(1)'],
});
const note = nip19.noteEncode(ID);
const nevent = nip19.neventEncode({ id: ID, relays: ['wss://r.example'], author: PK, kind: 1 });
const naddr = nip19.naddrEncode({ kind: 30402, pubkey: PK, identifier: 'piggy-bank', relays: [] });

const types = (tokens: NostrContentToken[]) => tokens.map((t) => t.type);

describe('decodeNostrEntity', () => {
  it('decodes npub / nprofile to profile tokens', () => {
    expect(decodeNostrEntity(`nostr:${npub}`)).toMatchObject({
      type: 'profile',
      pubkey: PK,
      relays: [],
    });
    expect(decodeNostrEntity(nprofile)).toMatchObject({
      type: 'profile',
      pubkey: PK2,
      // Non-websocket relay hints are dropped.
      relays: ['wss://relay.example'],
    });
  });

  it('decodes note / nevent to event tokens with hints', () => {
    expect(decodeNostrEntity(`nostr:${note}`)).toMatchObject({ type: 'event', id: ID, relays: [] });
    expect(decodeNostrEntity(`nostr:${nevent}`)).toMatchObject({
      type: 'event',
      id: ID,
      author: PK,
      kind: 1,
      relays: ['wss://r.example'],
    });
  });

  it('decodes naddr to an address token', () => {
    expect(decodeNostrEntity(`nostr:${naddr}`)).toMatchObject({
      type: 'address',
      kind: 30402,
      pubkey: PK,
      identifier: 'piggy-bank',
    });
  });

  it('rejects malformed, bad-checksum, upper-case and nsec input', () => {
    expect(decodeNostrEntity('nostr:npub1xyz')).toBeNull();
    // Flip one data character → checksum fails.
    const broken = npub.slice(0, 20) + (npub[20] === 'q' ? 'p' : 'q') + npub.slice(21);
    expect(decodeNostrEntity(broken)).toBeNull();
    expect(decodeNostrEntity(npub.toUpperCase())).toBeNull();
    const nsec = nip19.nsecEncode(new Uint8Array(32).fill(1));
    expect(decodeNostrEntity(nsec)).toBeNull();
  });
});

describe('parseNostrContent', () => {
  it('returns no tokens for empty input', () => {
    expect(parseNostrContent('')).toEqual([]);
  });

  it('keeps plain text as one token', () => {
    expect(parseNostrContent('hello world')).toEqual([{ type: 'text', text: 'hello world' }]);
  });

  it('splits a bio with an nprofile mention', () => {
    const tokens = parseNostrContent(`Message me on nostr:${nprofile} please`);
    expect(types(tokens)).toEqual(['text', 'profile', 'text']);
    expect(tokens[0]).toEqual({ type: 'text', text: 'Message me on ' });
    expect(tokens[2]).toEqual({ type: 'text', text: ' please' });
  });

  it('accepts a bare npub at a word boundary but not glued to other text', () => {
    expect(types(parseNostrContent(`ping ${npub}`))).toEqual(['text', 'profile']);
    expect(types(parseNostrContent(`x${npub}`))).toEqual(['text']);
  });

  it('absorbs an @ written before a mention', () => {
    const tokens = parseNostrContent(`dad (@${npub})`);
    expect(tokens[0]).toEqual({ type: 'text', text: 'dad (' });
    expect(tokens[1]).toMatchObject({ type: 'profile', pubkey: PK });
    expect(tokens[2]).toEqual({ type: 'text', text: ')' });
  });

  it('recognises note / nevent / naddr references', () => {
    const tokens = parseNostrContent(`a nostr:${note} b nostr:${nevent} c nostr:${naddr}`);
    expect(types(tokens)).toEqual(['text', 'event', 'text', 'event', 'text', 'address']);
  });

  it('classifies URLs and peels trailing punctuation', () => {
    const tokens = parseNostrContent(
      'pic https://x.example/a.JPG?w=1, clip https://x.example/v.mp4. site https://x.example/page).',
    );
    expect(tokens).toEqual([
      { type: 'text', text: 'pic ' },
      { type: 'image', url: 'https://x.example/a.JPG?w=1' },
      { type: 'text', text: ', clip ' },
      { type: 'video', url: 'https://x.example/v.mp4' },
      { type: 'text', text: '. site ' },
      { type: 'link', url: 'https://x.example/page' },
      { type: 'text', text: ').' },
    ]);
  });

  it('keeps a balanced closing paren inside a URL', () => {
    const tokens = parseNostrContent('see https://en.wikipedia.org/wiki/Pig_(disambiguation)');
    expect(tokens[1]).toEqual({
      type: 'link',
      url: 'https://en.wikipedia.org/wiki/Pig_(disambiguation)',
    });
  });

  it('does not treat an npub inside a URL as a mention', () => {
    const tokens = parseNostrContent(`https://njump.me/${npub}`);
    expect(types(tokens)).toEqual(['link']);
  });

  it('leaves malformed references in the text verbatim', () => {
    const input = 'broken nostr:note1qqqqqq and nostr:nevent1zzzzzzzz end';
    expect(parseNostrContent(input)).toEqual([{ type: 'text', text: input }]);
  });

  it('handles adjacent references and non-string input', () => {
    expect(types(parseNostrContent(`nostr:${npub}nostr:${note}`))).toEqual(['profile', 'event']);
    expect(parseNostrContent(undefined as unknown as string)).toEqual([]);
  });
});

describe('isPublicRelayUrl', () => {
  it('accepts public wss relays', () => {
    expect(isPublicRelayUrl('wss://relay.primal.net')).toBe(true);
    expect(isPublicRelayUrl('wss://nos.lol/')).toBe(true);
    expect(isPublicRelayUrl('wss://relay.example:4443/path')).toBe(true);
    expect(isPublicRelayUrl('wss://8.8.8.8')).toBe(true);
  });

  it('rejects ws, credentials, local and private hosts', () => {
    for (const bad of [
      'ws://relay.example',
      'wss://user:pass@relay.example',
      'wss://localhost:7777',
      'wss://printer.local',
      'wss://127.0.0.1',
      'wss://10.0.0.5',
      'wss://192.168.1.1:8080',
      'wss://172.16.4.2',
      'wss://169.254.1.1',
      'wss://[::1]',
      'wss://[fd00::1]',
      'wss://router',
      'javascript:alert(1)',
      42,
    ]) {
      expect(isPublicRelayUrl(bad)).toBe(false);
    }
  });

  it('canonicalises look-alike hosts before judging them (review #1334)', () => {
    for (const bad of [
      'wss://127.1', // numeric shorthand
      'wss://0x7f.1',
      'wss://2130706433', // 127.0.0.1 as one number
      'wss://0177.0.0.1', // octal
      'wss://10.1',
      'wss://192.168.257', // last part fills two bytes → 192.168.1.1
      'wss://localhost.', // trailing dot
      'wss://LOCALHOST..',
      'wss://relay.localhost',
      'wss://nas.lan',
      'wss://router.home.arpa',
      'wss://[::ffff:127.0.0.1]', // IPv4-mapped IPv6
      'wss://[::ffff:7f00:1]',
      'wss://[::127.0.0.1]',
      'wss://[::]',
      'wss://[fe80::1]:443',
      'wss://[fc00::1]',
      'wss://[ff02::1]',
      'wss://100.64.0.1',
      'wss://relay%2eexample.com',
      'wss://999.1.1.1',
    ]) {
      expect(isPublicRelayUrl(bad)).toBe(false);
    }
    expect(isPublicRelayUrl('wss://relay.example.com.')).toBe(true); // FQDN dot
    expect(isPublicRelayUrl('wss://[2606:4700::1111]')).toBe(true);
    expect(isPublicRelayUrl('wss://1.1.1.1:443')).toBe(true);
  });

  it('parses IPv4 literals like inet_aton', () => {
    expect(parseIPv4Literal('127.1')).toEqual([127, 0, 0, 1]);
    expect(parseIPv4Literal('0x7f.0.0.1')).toEqual([127, 0, 0, 1]);
    expect(parseIPv4Literal('2130706433')).toEqual([127, 0, 0, 1]);
    expect(parseIPv4Literal('192.168.257')).toEqual([192, 168, 1, 1]);
    expect(parseIPv4Literal('256.1.1.1')).toBeNull();
    expect(parseIPv4Literal('relay.example')).toBeNull();
  });
});

describe('embedKey / labels', () => {
  it('builds stable cache keys', () => {
    const [ev] = parseNostrContent(`nostr:${nevent}`);
    const [ad] = parseNostrContent(`nostr:${naddr}`);
    expect(embedKey(ev as Extract<NostrContentToken, { type: 'event' }>)).toBe(`e:${ID}`);
    expect(embedKey(ad as Extract<NostrContentToken, { type: 'address' }>)).toBe(
      `a:30402:${PK}:piggy-bank`,
    );
  });

  it('shortens npubs and builds a flat preview', () => {
    expect(shortNpubLabel(PK)).toMatch(/^npub1\w{5}…\w{4}$/);
    expect(previewText(`hi nostr:${npub}\n\nsee nostr:${note}`)).toBe(
      `hi @${shortNpubLabel(PK)} see ↪`,
    );
  });
});
