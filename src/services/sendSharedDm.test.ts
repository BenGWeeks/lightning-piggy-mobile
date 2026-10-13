import { mergeConversationMessages, DM_CONV_CAP } from '../contexts/nostrDmCache';
import { NWC_SHARE_KIND } from '../utils/nwcShareMessage';
import { sendSharedDm } from './sendSharedDm';
import type { SendResult } from '../contexts/useMessageSend';

const delivery = { eventId: 'rumor', kind: 14, delivered: true, relayResults: {} };
const append = jest.fn().mockResolvedValue(undefined);
const send = jest.fn<Promise<SendResult>, []>();

beforeEach(() => {
  append.mockClear();
  send.mockReset().mockResolvedValue({ success: true, delivery });
});

test.each(['marmot', 'nip17', 'nip04'] as const)(
  'a delivered share is visible in its %s thread with its stable rumor identity',
  async (protocol) => {
    const result = await sendSharedDm({ peer: 'middle', text: 'invoice', protocol, send, append });
    expect(result.success).toBe(true);
    expect(append).toHaveBeenCalledWith(
      'middle',
      expect.objectContaining({
        id: 'local-rumor',
        rumorId: 'rumor',
        text: 'invoice',
        fromMe: true,
        protocol,
        deliveryStatus: delivery,
      }),
    );
  },
);

test('a Marmot failure preserves fallback information and creates no delivered row', async () => {
  const failure: SendResult = { success: false, marmotUnreachable: 'noKeyPackage' };
  send.mockResolvedValue(failure);
  expect(
    await sendSharedDm({ peer: 'middle', text: 'invoice', protocol: 'marmot', send, append }),
  ).toBe(failure);
  expect(append).not.toHaveBeenCalled();
});

test('an open conversation can retain its existing composer persistence', async () => {
  await sendSharedDm({ peer: 'middle', text: 'invoice', protocol: 'nip17', send });
  expect(append).not.toHaveBeenCalled();
});

test('structured wallet shares preserve their card kind', async () => {
  await sendSharedDm({
    peer: 'middle',
    text: 'card',
    protocol: 'marmot',
    kind: NWC_SHARE_KIND,
    send,
    append,
  });
  expect(append).toHaveBeenCalledWith(
    'middle',
    expect.objectContaining({ wireKind: NWC_SHARE_KIND }),
  );
});

test.each([
  ['marmot', 'invoice', 14],
  ['marmot', 'card', NWC_SHARE_KIND],
  ['nip17', 'invoice', 14],
  ['nip04', 'invoice', 4],
] as const)(
  'a delayed %s %s share uses the rumor timestamp and dedupes its echo',
  async (protocol, text, kind) => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(1_700_000_000_000);
      send.mockImplementation(async () => {
        // First-time MLS setup (or signer approval) takes longer than the 30s echo window.
        jest.advanceTimersByTime(60_000);
        const rumorCreatedAt = Math.floor(Date.now() / 1000);
        // Publishing can also take time: the completion timestamp is not the rumor's.
        jest.advanceTimersByTime(60_000);
        return { success: true, delivery: { ...delivery, kind }, rumorCreatedAt };
      });
      await sendSharedDm({ peer: 'middle', text, protocol, kind, send, append });
      const local = append.mock.calls[0][1];
      expect(local.createdAt).toBe(1_700_000_060);
      const echo = { ...local, id: 'relay-echo', createdAt: 1_700_000_060 };
      expect(mergeConversationMessages([local], [echo], DM_CONV_CAP)).toHaveLength(1);
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  },
);
