// Signer independence (#1300): coordinate updates — and Marmot markers — must
// never reach the user's Nostr signer, so background shares work for nsec,
// Amber and NIP-46 users with no prompt. Every signer backend here throws.
const mockSecure = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockSecure.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void mockSecure.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void mockSecure.delete(k)),
}));
const signerCalled = () => {
  throw new Error('the user signer must not be used');
};
jest.mock('./amberService', () => new Proxy({}, { get: () => signerCalled }));
jest.mock('./nostrConnectService', () => new Proxy({}, { get: () => signerCalled }));
jest.mock('./marmotSigner', () => new Proxy({}, { get: () => signerCalled }));

const mockPublish = jest.fn();
jest.mock('./nostrService', () => ({
  publishSignedEvent: (...args: unknown[]) => mockPublish(...args),
}));

const mockSession = {
  pubkey: 'f'.repeat(64),
  getOrCreateDm: jest.fn(async (_peer: string) => ({ id: 'marmot:dm1', relays: [] })),
  sendRumor: jest.fn(
    async (_groupId: string, _rumor: unknown): Promise<Record<string, boolean>> => ({
      'wss://r': true,
    }),
  ),
  deliverOwn: jest.fn(),
  forgetRumor: jest.fn(async () => undefined),
};
let mockActive: typeof mockSession | null = mockSession;
jest.mock('./marmotSession', () => ({
  ...jest.requireActual('./marmotSession'),
  getMarmotSession: () => mockActive,
}));
jest.mock('./marmotSend', () => ({
  requireMarmotSession: (pk: string) => {
    if (!mockActive || mockActive.pubkey !== pk) throw new Error('not running');
    return mockActive;
  },
}));

import { verifyEvent } from 'nostr-tools';
import {
  deleteUpdateChannel,
  loadUpdateChannel,
  saveUpdateChannel,
  sendLiveUpdate,
  sendMarmotGroupMarker,
} from './liveLocationSender';
import { decryptSessionLiveUpdate, newLiveUpdateChannel } from './nostrLiveLocation';
import { decodeLivePingPayload, LIVE_LOCATION_PING_KIND } from './liveLocationService';
import type { OutgoingSession } from './liveLocationStateMachine';

const ME = 'f'.repeat(64);
const PEER = 'e'.repeat(64);
const payload = {
  lat: 51.5,
  lon: -0.12,
  accuracy: 6,
  heading: null,
  ts: 1_760_000_000_000,
  sessionId: 's1',
};
const session = (over: Partial<OutgoingSession> = {}): OutgoingSession => ({
  sessionId: 's1',
  senderPubkey: ME,
  recipientPubkey: PEER,
  startedAt: 1,
  durationMs: 3_600_000,
  lastPingAt: null,
  status: 'active',
  startMarkerSent: true,
  endMarkerSent: false,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSecure.clear();
  mockActive = mockSession;
});

describe('Marmot updates', () => {
  it('ride the 1:1 DM group as a kind-20069 app event — no signer, nothing on public relays', async () => {
    expect(await sendLiveUpdate(ME, session({ protocol: 'marmot' }), payload, ['wss://x'])).toBe(
      true,
    );
    expect(mockSession.getOrCreateDm).toHaveBeenCalledWith(PEER);
    const [groupId, rumor] = mockSession.sendRumor.mock.calls[0] as unknown as [
      string,
      { kind: number; pubkey: string; content: string; tags: string[][] },
    ];
    expect(groupId).toBe('marmot:dm1');
    expect(rumor).toMatchObject({ kind: LIVE_LOCATION_PING_KIND, pubkey: ME, tags: [] });
    expect(decodeLivePingPayload(rumor.content)).toEqual(payload);
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('go to the whole group for a group share', async () => {
    await sendLiveUpdate(
      ME,
      session({ groupId: 'marmot:g1', recipientPubkey: 'marmot:g1', protocol: 'marmot' }),
      payload,
      [],
    );
    expect(mockSession.getOrCreateDm).not.toHaveBeenCalled();
    expect(mockSession.sendRumor.mock.calls[0][0]).toBe('marmot:g1');
  });

  it('never start a Marmot session (headless) or send as another account', async () => {
    mockActive = null;
    expect(await sendLiveUpdate(ME, session({ protocol: 'marmot' }), payload, [])).toBe(false);
    mockActive = { ...mockSession, pubkey: PEER };
    expect(await sendLiveUpdate(ME, session({ protocol: 'marmot' }), payload, [])).toBe(false);
  });

  it('report false when no relay accepted', async () => {
    mockSession.sendRumor.mockResolvedValueOnce({ 'wss://r': false });
    expect(await sendLiveUpdate(ME, session({ protocol: 'marmot' }), payload, [])).toBe(false);
  });
});

describe('NIP-17 updates', () => {
  it('are signed by the session key, carry no tags, and NIP-44 decrypt with the shared secret', async () => {
    const channel = newLiveUpdateChannel();
    await saveUpdateChannel('s1', channel);
    expect(await sendLiveUpdate(ME, session(), payload, ['wss://x'])).toBe(true);
    const [event, relays] = mockPublish.mock.calls[0];
    expect(relays).toEqual(['wss://x']);
    expect(verifyEvent(event)).toBe(true);
    expect(event.pubkey).toBe(channel.pubkey);
    expect(event.pubkey).not.toBe(ME);
    expect(event.kind).toBe(LIVE_LOCATION_PING_KIND);
    expect(event.tags).toEqual([]); // no p / d metadata for relays
    const plain = decryptSessionLiveUpdate(channel.secret, event.content);
    expect(decodeLivePingPayload(plain!)).toEqual(payload);
    expect(decryptSessionLiveUpdate(newLiveUpdateChannel().secret, event.content)).toBeNull();
  });

  it('need the stored channel (deleted when the share ends)', async () => {
    const channel = newLiveUpdateChannel();
    await saveUpdateChannel('s1', channel);
    expect(await loadUpdateChannel('s1')).toEqual(channel);
    await deleteUpdateChannel('s1');
    expect(await loadUpdateChannel('s1')).toBeNull();
    expect(await sendLiveUpdate(ME, session(), payload, [])).toBe(false);
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('never throw on a relay failure', async () => {
    await saveUpdateChannel('s1', newLiveUpdateChannel());
    mockPublish.mockRejectedValueOnce(new Error('offline'));
    expect(await sendLiveUpdate(ME, session(), payload, [])).toBe(false);
  });
});

describe('group markers', () => {
  const draft = {
    kind: 14,
    content: '📍 Live location ended',
    tags: [['live-location', 'end', 's1', '1', '2', '']],
  };

  it('send as Marmot chat (kind 9) and apply locally via the inbound path', async () => {
    expect(await sendMarmotGroupMarker(ME, 'marmot:g1', draft)).toBe(true);
    const rumor = mockSession.sendRumor.mock.calls[0][1] as unknown as {
      kind: number;
      tags: string[][];
    };
    expect(rumor.kind).toBe(9);
    expect(rumor.tags).toEqual(draft.tags);
    expect(mockSession.deliverOwn).toHaveBeenCalledWith('marmot:g1', rumor);
  });

  it('forget the saved rumor when no relay accepted it', async () => {
    mockSession.sendRumor.mockResolvedValueOnce({ 'wss://r': false });
    expect(await sendMarmotGroupMarker(ME, 'marmot:g1', draft)).toBe(false);
    expect(mockSession.deliverOwn).not.toHaveBeenCalled();
    expect(mockSession.forgetRumor).toHaveBeenCalled();
  });
});
