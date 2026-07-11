/**
 * Wire-format guards for outgoing NIP-17 kind-14 rumors:
 *
 *  - `createGroupChatRumor`: subject tag is what foreign clients
 *    (Amethyst / Quartz, 0xchat) read to display the group name —
 *    Lightning Piggy's outgoing messages MUST include it for
 *    cross-client interop. Issue #271.
 *  - `createDirectMessageRumor`: 1:1 direct messages must NOT carry
 *    a subject tag and must p-tag exactly the recipient — this is
 *    what `classifyRumor` keys off when distinguishing DMs from
 *    group rumors on receive. Issue #140.
 *
 * Also covers perf-critical verify path:
 *  - kind 1059 (NIP-59 gift-wrap) must skip schnorr and use only
 *    structural `validateEvent` — the outer wrap uses an ephemeral key
 *    so schnorr provides no integrity signal. (#739 Fix 5)
 *
 * And the inlined `wrapManyEvents` parity tests (#1033):
 *  - `sendNip17ToManyWithNsec` inlined loop produces the same wrap
 *    count and recipient set as the old `wrapManyEvents` call.
 */

import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import * as nip59 from 'nostr-tools/nip59';
import {
  createDirectMessageRumor,
  createGroupChatRumor,
  pool,
  sendNip17ToManyWithNsec,
} from './nostrService';

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

describe('createDirectMessageRumor (outgoing 1:1 kind-14)', () => {
  it('builds a kind-14 rumor (NIP-17 chat) with the sender pubkey', () => {
    const rumor = createDirectMessageRumor({
      senderPubkey: PK_A,
      recipientPubkey: PK_B,
      content: 'hello',
    });
    expect(rumor.kind).toBe(14);
    expect(rumor.pubkey).toBe(PK_A);
    expect(rumor.content).toBe('hello');
  });

  it('emits exactly one p tag pointing at the recipient', () => {
    const rumor = createDirectMessageRumor({
      senderPubkey: PK_A,
      recipientPubkey: PK_B,
      content: 'hi',
    });
    const ps = rumor.tags.filter((t) => t[0] === 'p').map((t) => t[1]);
    expect(ps).toEqual([PK_B]);
  });

  it('does NOT include a subject tag (would mis-classify as group on receive)', () => {
    const rumor = createDirectMessageRumor({
      senderPubkey: PK_A,
      recipientPubkey: PK_B,
      content: 'hi',
    });
    const subject = rumor.tags.find((t) => t[0] === 'subject');
    expect(subject).toBeUndefined();
  });

  it('does NOT use legacy NIP-04 kind 4', () => {
    // Belt-and-suspenders guard: issue #140 explicitly removes kind 4
    // from the outbound DM path. If a future refactor regresses to
    // kind 4 this test fails loudly.
    const rumor = createDirectMessageRumor({
      senderPubkey: PK_A,
      recipientPubkey: PK_C,
      content: 'no leaks',
    });
    expect(rumor.kind).not.toBe(4);
  });
});

describe('pool.verifyEvent — skip-verify kinds (#739 Fix 5)', () => {
  // Build the minimal structural fields validateEvent needs. We do NOT
  // supply a valid id/sig — the point is that for skip-verify kinds the
  // patched pool.verifyEvent accepts structurally valid events even with
  // a garbage signature, whereas for schnorr-verified kinds (e.g. kind 1)
  // the same garbage signature causes a rejection.
  const BASE_PUBKEY = 'a'.repeat(64);

  function makeEvent(kind: number) {
    return {
      id: 'b'.repeat(64),
      pubkey: BASE_PUBKEY,
      created_at: 1700000000,
      kind,
      tags: [],
      content: 'test',
      // Deliberately invalid sig — schnorr verify would fail.
      sig: 'c'.repeat(128),
    };
  }

  it('kind 1059 (gift-wrap) passes with a structurally valid event but invalid sig', () => {
    // schnorr would reject this; structural validate passes it.
    // Confirms that k1059 is in SKIP_VERIFY_KINDS.
    expect(pool.verifyEvent(makeEvent(1059) as Parameters<typeof pool.verifyEvent>[0])).toBe(true);
  });

  it('kind 37516 (NIP-GC cache listing) passes with invalid sig (existing skip-verify)', () => {
    expect(pool.verifyEvent(makeEvent(37516) as Parameters<typeof pool.verifyEvent>[0])).toBe(true);
  });

  it('kind 31923 (NIP-52 meetup) passes with invalid sig (existing skip-verify)', () => {
    expect(pool.verifyEvent(makeEvent(31923) as Parameters<typeof pool.verifyEvent>[0])).toBe(true);
  });

  // NOTE: We don't test that non-skip kinds reject invalid sigs here —
  // that would be testing nostr-tools' schnorr implementation, not our code.
  // The positive tests above are sufficient to confirm SKIP_VERIFY_KINDS
  // membership; schnorr correctness is nostr-tools' responsibility.
});

// ---------------------------------------------------------------------------
// sendNip17ToManyWithNsec — inlined wrap loop parity (#1033)
//
// The old path called nip59.wrapManyEvents synchronously (one blocking crypto
// burst). The new path inlines the same wrapEvent loop with yieldToEventLoop()
// between iterations so UI can paint between recipients. These tests verify:
//   1. Same wrap COUNT as wrapManyEvents for a 5-member group.
//   2. Every recipient (+ self-wrap) has exactly one gift-wrap (kind 1059)
//      with a matching `p` tag.
//   3. Sender is always included (self-wrap — parity with wrapManyEvents).
//   4. Duplicate recipients are deduplicated (parity with wrapManyEvents dedup).
//
// We mock `publishWrapsTrackingRelays` to capture the wraps array so we can
// inspect it without needing live relay connections.
// ---------------------------------------------------------------------------

// jest.mock factories are hoisted above the rest of the module (including
// this file's own top-level `const`s), and babel-plugin-jest-hoist forbids a
// factory from closing over an out-of-scope variable unless its name starts
// with `mock` (case-insensitive) — the one exemption to the hoisting rule.
// Without the `mock` prefix this only works by accident: the factory body
// itself runs at hoist time (before the `const` below is initialized), but
// the inner `jest.fn(async (wraps) => { ... })` closure is merely *defined*
// then — it isn't *called* until a test invokes `publishWrapsTrackingRelays`
// well after the module (and this `const`) has finished initializing. That
// ordering happens to save it here, but it's fragile and exactly the kind of
// TDZ footgun the `mock` prefix exists to avoid, so we opt into the sanctioned
// pattern instead of relying on call-timing.
const mockCapturedWraps: unknown[] = [];
jest.mock('./nostrDmPublish', () => ({
  publishWrapsTrackingRelays: jest.fn(async (wraps: unknown[]) => {
    mockCapturedWraps.length = 0;
    mockCapturedWraps.push(...wraps);
    return {
      wrapsPublished: wraps.length,
      errors: [],
      delivery: { delivered: true, relayResults: {}, eventId: 'test', kind: 14 },
    };
  }),
}));

// yieldToEventLoop uses requestAnimationFrame. jest-expo exposes it globally
// via jsdom / react-native preset; spy on it so we can assert it fires.
beforeEach(() => {
  mockCapturedWraps.length = 0;
});

describe('sendNip17ToManyWithNsec — inlined wrapEvent loop parity (#1033)', () => {
  const senderKey = generateSecretKey();
  const senderPubkey = getPublicKey(senderKey);
  const recipientKeys = Array.from({ length: 4 }, () => generateSecretKey());
  const recipientPubkeys = recipientKeys.map(getPublicKey);

  const rumor = {
    kind: 14,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['subject', 'Test Group'], ...recipientPubkeys.map((p) => ['p', p])],
    content: 'hello group',
  };

  it('produces self-wrap + one wrap per recipient (matches wrapManyEvents count)', async () => {
    // Reference count from wrapManyEvents: 1 self + N recipients.
    const expectedCount = 1 + recipientPubkeys.length;
    // wrapManyEvents deduplicates senderPubkey from the recipient list —
    // our loop does the same via the Set dedup step.
    const referenceWraps = nip59.wrapManyEvents(
      rumor as Parameters<typeof nip59.wrapManyEvents>[0],
      senderKey,
      recipientPubkeys,
    );
    expect(referenceWraps).toHaveLength(expectedCount);

    await sendNip17ToManyWithNsec({
      senderSecretKey: senderKey,
      rumor,
      recipientPubkeys,
      relays: ['wss://test'],
    });

    expect(mockCapturedWraps).toHaveLength(expectedCount);
  });

  it('every produced wrap is kind 1059 (NIP-59 gift-wrap)', async () => {
    await sendNip17ToManyWithNsec({
      senderSecretKey: senderKey,
      rumor,
      recipientPubkeys,
      relays: ['wss://test'],
    });

    for (const w of mockCapturedWraps) {
      expect((w as { kind: number }).kind).toBe(1059);
    }
  });

  it('wrap recipient p-tags cover every deduplicated recipient including self', async () => {
    await sendNip17ToManyWithNsec({
      senderSecretKey: senderKey,
      rumor,
      recipientPubkeys,
      relays: ['wss://test'],
    });

    const pTagged = new Set(
      mockCapturedWraps.map((w) => {
        const tags = (w as { tags: string[][] }).tags;
        const pTag = tags.find((t) => t[0] === 'p');
        return pTag ? pTag[1] : null;
      }),
    );

    // All original recipients should be covered.
    for (const pk of recipientPubkeys) {
      expect(pTagged.has(pk)).toBe(true);
    }
    // Self (sender) must also be covered.
    expect(pTagged.has(senderPubkey)).toBe(true);
    // No duplicate p-tags (each recipient gets exactly one wrap).
    expect(pTagged.size).toBe(mockCapturedWraps.length);
  });

  it('deduplicates recipient who equals the sender (no double self-wrap)', async () => {
    // Include the sender's own pubkey in the recipient list — wrapManyEvents
    // deduplicates via Set so only one wrap goes to self. Our inlined loop
    // uses the same dedup step.
    const recipientsWithSelf = [...recipientPubkeys, senderPubkey];
    const expectedCount = 1 + recipientPubkeys.length; // same as without the extra self entry

    await sendNip17ToManyWithNsec({
      senderSecretKey: senderKey,
      rumor,
      recipientPubkeys: recipientsWithSelf,
      relays: ['wss://test'],
    });

    expect(mockCapturedWraps).toHaveLength(expectedCount);
  });

  it('yieldToEventLoop is called between recipients (not on the first wrap)', async () => {
    const rafSpy = jest.spyOn(global, 'requestAnimationFrame');
    rafSpy.mockImplementation((cb) => {
      cb(performance.now());
      return 0;
    });

    try {
      await sendNip17ToManyWithNsec({
        senderSecretKey: senderKey,
        rumor,
        recipientPubkeys: recipientPubkeys.slice(0, 2), // 3 wraps: self + 2
        relays: ['wss://test'],
      });

      // 3 wraps, yields happen between iterations (i > 0), so RAF fires twice.
      expect(rafSpy).toHaveBeenCalledTimes(2);
    } finally {
      rafSpy.mockRestore();
    }
  });
});
