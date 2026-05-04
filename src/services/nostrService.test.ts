/**
 * Wire-format guards for `createGroupChatRumor` (outgoing NIP-17
 * kind-14). The subject tag is what foreign clients (Amethyst /
 * Quartz, 0xchat) read to display the group name — Lightning
 * Piggy's outgoing messages MUST include it for cross-client
 * interop. Issue #271.
 *
 * Lifecycle guards for `subscribeInboxDmEvents` (issue #188): the
 * persistent relay subscription must open the right filters, route
 * events to the kind-specific callbacks, and close every underlying
 * sub on teardown so we don't leak relay quota across logins.
 */

// jest.mock factory bodies must not reference outer-scope variables
// (jest hoists the mock above any top-level `const`s). So the mock
// state lives on a globalThis-namespaced bag the factory populates,
// and the test reads it back from there. Each subscribeMany call
// returns a fresh handle whose `close` we can assert was invoked.
type MockSub = {
  close: jest.Mock;
  filter: unknown;
  handlers: { onevent: Function; oneose?: Function };
};
type MockBag = { subs: MockSub[]; subscribeMany: jest.Mock };
jest.mock('nostr-tools/pool', () => {
  const subs: MockSub[] = [];
  const subscribeMany = jest.fn(
    (_relays: string[], filter: unknown, handlers: { onevent: Function; oneose?: Function }) => {
      const sub: MockSub = { close: jest.fn(), filter, handlers };
      subs.push(sub);
      return sub;
    },
  );
  // Stash on globalThis so the test body can read/clear it without
  // tripping the "out-of-scope reference" check on the factory.
  (globalThis as unknown as { __nostrPoolMock: MockBag }).__nostrPoolMock = {
    subs,
    subscribeMany,
  };
  return {
    SimplePool: jest.fn().mockImplementation(() => ({
      subscribeMany,
      querySync: jest.fn().mockResolvedValue([]),
      close: jest.fn(),
      listConnectionStatus: jest.fn().mockReturnValue(new Map()),
    })),
  };
});

import { createGroupChatRumor, subscribeInboxDmEvents } from './nostrService';

const poolMock = (): MockBag =>
  (globalThis as unknown as { __nostrPoolMock: MockBag }).__nostrPoolMock;

const PK_A = 'a'.repeat(64);
const PK_B = 'b'.repeat(64);
const PK_C = 'c'.repeat(64);

describe('createGroupChatRumor (outgoing kind-14)', () => {
  it('includes a subject tag carrying the group name', () => {
    const rumor = createGroupChatRumor({
      senderPubkey: PK_A,
      subject: 'Pizza Friday',
      memberPubkeys: [PK_B, PK_C],
      content: 'who is in?',
    });
    const subject = rumor.tags.find((t) => t[0] === 'subject');
    expect(subject).toEqual(['subject', 'Pizza Friday']);
  });

  it('emits one p tag per recipient member', () => {
    const rumor = createGroupChatRumor({
      senderPubkey: PK_A,
      subject: 'x',
      memberPubkeys: [PK_B, PK_C],
      content: 'hi',
    });
    const ps = rumor.tags.filter((t) => t[0] === 'p').map((t) => t[1]);
    expect(ps).toEqual([PK_B, PK_C]);
  });

  it('builds a kind-14 rumor (NIP-17 chat)', () => {
    const rumor = createGroupChatRumor({
      senderPubkey: PK_A,
      subject: 'x',
      memberPubkeys: [PK_B],
      content: 'hi',
    });
    expect(rumor.kind).toBe(14);
    expect(rumor.pubkey).toBe(PK_A);
    expect(rumor.content).toBe('hi');
  });
});

describe('subscribeInboxDmEvents (persistent DM sub, #188)', () => {
  beforeEach(() => {
    poolMock().subs.length = 0;
    poolMock().subscribeMany.mockClear();
  });

  it('opens three subs (sent kind-4, received kind-4, kind-1059 wraps) on the supplied relays', () => {
    const unsubscribe = subscribeInboxDmEvents({
      myPubkey: PK_A,
      relays: ['wss://relay.example'],
      onKind4: jest.fn(),
      onKind1059: jest.fn(),
    });

    expect(poolMock().subscribeMany).toHaveBeenCalledTimes(3);
    const filters = poolMock().subs.map((s) => s.filter as Record<string, unknown>);

    // Sent kind-4: authors = me.
    expect(filters[0]).toMatchObject({ kinds: [4], authors: [PK_A] });
    // Received kind-4: #p tag = me.
    expect(filters[1]).toMatchObject({ kinds: [4], '#p': [PK_A] });
    // NIP-17 wraps: kind 1059, #p = me.
    expect(filters[2]).toMatchObject({ kinds: [1059], '#p': [PK_A] });

    unsubscribe();
  });

  it('routes incoming events to onKind4 vs onKind1059 by kind', () => {
    const onKind4 = jest.fn();
    const onKind1059 = jest.fn();
    const unsubscribe = subscribeInboxDmEvents({
      myPubkey: PK_A,
      relays: ['wss://relay.example'],
      onKind4,
      onKind1059,
    });

    const k4Event = {
      id: 'k4-1',
      pubkey: PK_B,
      kind: 4,
      created_at: 1,
      tags: [['p', PK_A]],
      content: 'enc',
      sig: 's',
    };
    const wrapEvent = {
      id: 'wrap-1',
      pubkey: PK_C,
      kind: 1059,
      created_at: 2,
      tags: [['p', PK_A]],
      content: 'enc',
      sig: 's',
    };

    // Fire each handler — the receive-kind-4 sub (idx 1) gets the k4
    // event; the wraps sub (idx 2) gets the wrap. Both should land in
    // their respective callbacks.
    poolMock().subs[1].handlers.onevent(k4Event);
    poolMock().subs[2].handlers.onevent(wrapEvent);

    expect(onKind4).toHaveBeenCalledWith(k4Event);
    expect(onKind1059).toHaveBeenCalledWith(wrapEvent);

    unsubscribe();
  });

  it('closes every underlying sub on unsubscribe (no relay-quota leak)', () => {
    const unsubscribe = subscribeInboxDmEvents({
      myPubkey: PK_A,
      relays: ['wss://relay.example'],
      onKind4: jest.fn(),
      onKind1059: jest.fn(),
    });
    const subs = poolMock().subs;
    expect(subs).toHaveLength(3);
    expect(subs.every((s) => s.close.mock.calls.length === 0)).toBe(true);

    unsubscribe();

    expect(subs.every((s) => s.close.mock.calls.length === 1)).toBe(true);
  });

  it('survives an underlying sub.close throwing (other subs still close)', () => {
    const unsubscribe = subscribeInboxDmEvents({
      myPubkey: PK_A,
      relays: ['wss://relay.example'],
      onKind4: jest.fn(),
      onKind1059: jest.fn(),
    });
    const subs = poolMock().subs;
    subs[0].close.mockImplementationOnce(() => {
      throw new Error('socket gone');
    });

    expect(() => unsubscribe()).not.toThrow();
    // Subs 1 and 2 still get their close call despite sub 0 throwing.
    expect(subs[1].close).toHaveBeenCalledTimes(1);
    expect(subs[2].close).toHaveBeenCalledTimes(1);
  });

  it('a re-subscribe (e.g. relay-set change) opens a fresh set of subs', () => {
    const off1 = subscribeInboxDmEvents({
      myPubkey: PK_A,
      relays: ['wss://relay-a.example'],
      onKind4: jest.fn(),
      onKind1059: jest.fn(),
    });
    expect(poolMock().subscribeMany).toHaveBeenCalledTimes(3);
    off1();
    expect(
      poolMock()
        .subs.slice(0, 3)
        .every((s) => s.close.mock.calls.length === 1),
    ).toBe(true);

    const off2 = subscribeInboxDmEvents({
      myPubkey: PK_A,
      relays: ['wss://relay-b.example'],
      onKind4: jest.fn(),
      onKind1059: jest.fn(),
    });
    expect(poolMock().subscribeMany).toHaveBeenCalledTimes(6);
    expect(poolMock().subs).toHaveLength(6);
    off2();
    expect(
      poolMock()
        .subs.slice(3, 6)
        .every((s) => s.close.mock.calls.length === 1),
    ).toBe(true);
  });

  it('a handler that throws does not break event delivery to sibling subs', () => {
    const onKind1059 = jest.fn().mockImplementation(() => {
      throw new Error('downstream blew up');
    });
    const onKind4 = jest.fn();
    const unsubscribe = subscribeInboxDmEvents({
      myPubkey: PK_A,
      relays: ['wss://relay.example'],
      onKind4,
      onKind1059,
    });
    const subs = poolMock().subs;

    const wrap = {
      id: 'w',
      pubkey: PK_C,
      kind: 1059,
      created_at: 1,
      tags: [['p', PK_A]],
      content: 'x',
      sig: 's',
    };
    // Should not bubble — the SUT swallows handler errors so a buggy
    // consumer can't tear down the WebSocket.
    expect(() => subs[2].handlers.onevent(wrap)).not.toThrow();

    const k4 = {
      id: 'k',
      pubkey: PK_B,
      kind: 4,
      created_at: 2,
      tags: [['p', PK_A]],
      content: 'y',
      sig: 's',
    };
    subs[1].handlers.onevent(k4);
    expect(onKind4).toHaveBeenCalledWith(k4);

    unsubscribe();
  });
});
