import { getEventHash } from 'nostr-tools';

import { MarmotNoKeyPackageError, setMarmotSession, type MarmotSession } from './marmotSession';
import { marmotDelivery, sendMarmotDm } from './marmotSend';

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
      error: expect.stringMatching(/set up Marmot/),
      marmotUnreachable: true,
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
