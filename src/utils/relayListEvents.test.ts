import {
  buildDmInboxEvent,
  buildRelayListEvent,
  dmInboxRelaysFromTags,
  relayListFromTags,
  isPublishableRelayUrl,
  relayListPublishTargets,
} from './relayListEvents';

describe('relay list events', () => {
  it('builds a NIP-65 list with read/write markers, deduped and normalised', () => {
    const e = buildRelayListEvent(
      [
        { url: 'wss://relay.primal.net/', read: true, write: true },
        { url: 'wss://relay.primal.net', read: true, write: true },
        { url: 'wss://nos.lol', read: true, write: false },
        { url: 'wss://nostr.mom', read: false, write: true },
        { url: 'wss://dead.example', read: false, write: false },
      ],
      1_700_000_000_000,
    );
    expect(e).toEqual({
      kind: 10002,
      created_at: 1_700_000_000,
      content: '',
      tags: [
        ['r', 'wss://relay.primal.net'],
        ['r', 'wss://nos.lol', 'read'],
        ['r', 'wss://nostr.mom', 'write'],
      ],
    });
  });

  it('never publishes local or non-TLS relays', () => {
    for (const bad of [
      'ws://localhost:10547',
      'wss://localhost',
      'ws://relay.example',
      'wss://192.168.1.89',
      'wss://box.local',
      'wss://[::1]',
      'wss://[fd00::1]',
      'wss://[fe80::1]',
      'wss://169.254.1.1',
      'wss://100.64.0.1',
      'wss://0.0.0.0',
      'https://relay.example',
      'nonsense',
    ])
      expect(isPublishableRelayUrl(bad)).toBe(false);
    expect(isPublishableRelayUrl('wss://relay.snort.social')).toBe(true);
    expect(isPublishableRelayUrl('wss://[2001:db8::1]')).toBe(true);
    expect(isPublishableRelayUrl('wss://100.128.0.1')).toBe(true);
    expect(
      buildRelayListEvent([{ url: 'ws://localhost:10547', read: true, write: true }]).tags,
    ).toEqual([]);
  });

  it('builds and parses a NIP-17 DM inbox list', () => {
    const e = buildDmInboxEvent(['wss://relay.primal.net', 'wss://nostr.mom/', 'wss://nostr.mom']);
    expect(e.kind).toBe(10050);
    expect(e.tags).toEqual([
      ['relay', 'wss://relay.primal.net'],
      ['relay', 'wss://nostr.mom'],
    ]);
    expect(dmInboxRelaysFromTags([...e.tags, ['p', 'x']])).toEqual([
      'wss://relay.primal.net',
      'wss://nostr.mom',
    ]);
  });

  it('publishes to old + new relays and the indexers, so the old list is replaced where it lived', () => {
    expect(
      relayListPublishTargets(
        ['wss://nostr.land', 'wss://relay.primal.net'],
        ['wss://relay.primal.net', 'wss://nostr.mom'],
      ),
    ).toEqual([
      'wss://nostr.land',
      'wss://relay.primal.net',
      'wss://nostr.mom',
      'wss://purplepag.es',
      'wss://user.kindpag.es',
    ]);
  });
});

it('reads back exactly the rows that were signed', () => {
  const e = buildRelayListEvent([
    { url: 'wss://relay.primal.net', read: true, write: true },
    { url: 'ws://localhost:10547', read: true, write: true },
    { url: 'wss://nos.lol', read: true, write: false },
    { url: 'wss://off.example', read: false, write: false },
  ]);
  expect(relayListFromTags(e.tags)).toEqual([
    { url: 'wss://relay.primal.net', read: true, write: true },
    { url: 'wss://nos.lol', read: true, write: false },
  ]);
});
