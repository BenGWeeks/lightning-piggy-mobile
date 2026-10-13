import { sendSharedDm } from './sendSharedDm';
import { mergeConversationMessages, DM_CONV_CAP } from '../contexts/nostrDmCache';
import { NWC_SHARE_KIND } from '../utils/nwcShareMessage';
import { getEventHash } from 'nostr-tools';

import {
  MarmotNoKeyPackageError,
  MarmotUnusableKeyPackageError,
  setMarmotSession,
  type MarmotSession,
} from './marmotSession';
import { marmotDelivery, sendMarmotDm, sendMarmotGroupRumor } from './marmotSend';
import { marmotReplyTags } from './marmotEdits';
import { marmotRumorToGroupMessage, marmotRumorToDmRow } from './marmotInbox';
import { buildMarmotRumor } from './marmotSession';

const ME = 'a'.repeat(64);
const PEER = 'b'.repeat(64);

function fakeSession(overrides: Partial<MarmotSession> = {}) {
  const sent: { groupId: string; rumor: { id: string; kind: number; tags: string[][] } }[] = [];
  const session = {
    pubkey: ME,
    stop: () => undefined,
    getOrCreateDm: async () => ({ id: 'marmot:dm', relays: ['wss://r1', 'wss://r2'] }),
    sendRumor: async (groupId: string, rumor: (typeof sent)[number]['rumor']) => {
      sent.push({ groupId, rumor });
      return { 'wss://r1': true, 'wss://r2': false };
    },
    ...overrides,
  } as unknown as MarmotSession;
  setMarmotSession(session);
  return sent;
}

afterEach(() => setMarmotSession(null));

it('round-trips the same White Noise reply tags through group and 1:1 Marmot sends', async () => {
  const sent = fakeSession();
  const parent = 'c'.repeat(64);
  const draft = {
    kind: 14,
    content: 'reply',
    tags: marmotReplyTags(parent),
    created_at: 1700000000,
  };
  const result = await sendMarmotGroupRumor(ME, 'marmot:group', draft);
  await sendMarmotDm(ME, PEER, draft);
  const expected = buildMarmotRumor(ME, { ...draft, kind: 9 });
  expect(result).toMatchObject({ success: true, rumorId: expected.id });
  expect(sent.map(({ rumor }) => rumor)).toEqual([expected, expected]);
  expect(expected.tags).toEqual([
    ['e', parent],
    ['q', parent],
  ]);
  expect(marmotRumorToGroupMessage(expected)).toMatchObject({ replyTo: parent });
  expect(
    marmotRumorToDmRow(ME, {
      group: { id: 'marmot:dm', isDm: true, memberPubkeys: [PEER] } as Parameters<
        typeof marmotRumorToDmRow
      >[1]['group'],
      rumor: expected,
    }),
  ).toMatchObject({ replyTo: parent });
});

describe('sendMarmotDm', () => {
  it('keeps a structured rumor byte-identical so content-addressed ids (polls) match', async () => {
    const sent = fakeSession();
    const poll = {
      pubkey: ME,
      kind: 1068,
      created_at: 1_700_000_000,
      tags: [
        ['p', PEER],
        ['option', '0', 'Oink'],
        ['polltype', 'singlechoice'],
      ],
      content: 'Best snack?',
    };
    const ready = jest.fn();
    const result = await sendMarmotDm(ME, PEER, poll, { onRumorReady: ready });
    expect(sent[0].rumor.id).toBe(getEventHash(poll));
    expect(ready).toHaveBeenCalledWith({
      eventId: getEventHash(poll),
      kind: 1068,
      relays: ['wss://r1', 'wss://r2'],
    });
    expect(result.success).toBe(true);
    expect(result.delivery?.relayResults).toEqual({ 'wss://r1': 'ok', 'wss://r2': 'failed' });
  });

  it('sends app text (kind 14) as Marmot chat (kind 9) but reports the app kind', async () => {
    const sent = fakeSession();
    const ready = jest.fn();
    await sendMarmotDm(ME, PEER, { kind: 14, content: 'oink' }, { onRumorReady: ready });
    expect(sent[0].rumor.kind).toBe(9);
    expect(ready.mock.calls[0][0].kind).toBe(14);
  });

  it('gives identical text to different recipients different ids (p tag kept)', async () => {
    const sent = fakeSession();
    const created_at = 1_700_000_000;
    const other = 'c'.repeat(64);
    await sendMarmotDm(ME, PEER, { kind: 14, content: 'oink', tags: [['p', PEER]], created_at });
    await sendMarmotDm(ME, other, { kind: 14, content: 'oink', tags: [['p', other]], created_at });
    expect(sent[0].rumor.id).not.toBe(sent[1].rumor.id);
    expect(sent[0].rumor.tags).toEqual([['p', PEER]]);
  });

  it('explains a missing key package instead of failing opaquely', async () => {
    fakeSession({
      getOrCreateDm: async () => {
        throw new MarmotNoKeyPackageError(PEER);
      },
    });
    const result = await sendMarmotDm(ME, PEER, { kind: 14, content: 'hi' });
    // Flagged so the 1:1 composer re-sends it over NIP-17 instead.
    expect(result).toEqual({
      success: false,
      error: expect.stringMatching(/open their Marmot app/),
      marmotUnreachable: 'noKeyPackage',
    });
  });

  it('flags an unusable (older-Marmot) key package as outdated', async () => {
    fakeSession({
      getOrCreateDm: async () => {
        throw new MarmotUnusableKeyPackageError(PEER);
      },
    });
    const result = await sendMarmotDm(ME, PEER, { kind: 14, content: 'hi' });
    expect(result).toEqual({
      success: false,
      error: expect.stringMatching(/expired, or uses an older version of Marmot/),
      marmotUnreachable: 'outdatedKeyPackage',
    });
  });

  it('fails cleanly before the session has started', async () => {
    const result = await sendMarmotDm(ME, PEER, { kind: 14, content: 'hi' });
    expect(result.success).toBe(false);
  });
});

describe('marmotDelivery', () => {
  it('is delivered when any relay accepted', () => {
    expect(marmotDelivery({ a: false, b: true }, { eventId: 'e', kind: 14 })).toMatchObject({
      delivered: true,
      targetRelayCount: 2,
    });
    expect(marmotDelivery({ a: false }, { eventId: 'e', kind: 14 }).delivered).toBe(false);
  });
});

it.each([14, NWC_SHARE_KIND])(
  'persists kind %s with the timestamp built after slow first-time Marmot setup',
  async (kind) => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(1_700_000_000_000);
      let builtAt = 0;
      fakeSession({
        getOrCreateDm: async () => {
          jest.advanceTimersByTime(60_000);
          return { id: 'marmot:dm', relays: ['wss://r1'] } as Awaited<
            ReturnType<MarmotSession['getOrCreateDm']>
          >;
        },
        sendRumor: async (_group, rumor) => {
          builtAt = rumor.created_at;
          jest.advanceTimersByTime(60_000);
          return { 'wss://r1': true };
        },
      });
      const append = jest.fn().mockResolvedValue(undefined);
      await sendSharedDm({
        peer: PEER,
        text: 'shared content',
        protocol: 'marmot',
        kind,
        send: () => sendMarmotDm(ME, PEER, { kind, content: 'shared content' }),
        append,
      });
      const local = append.mock.calls[0][1];
      expect(builtAt).toBe(1_700_000_060);
      expect(local.createdAt).toBe(builtAt);
      expect(
        mergeConversationMessages(
          [local],
          [{ ...local, id: 'echo', createdAt: builtAt }],
          DM_CONV_CAP,
        ),
      ).toHaveLength(1);
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  },
);
