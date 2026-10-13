import { bech32 } from '@scure/base';
import { npubEncode, nprofileEncode } from 'nostr-tools/nip19';
import { Alert } from '../components/BrandedAlert';
import { confirmLinkAction, linkActionDescription } from './confirmLinkAction';
import { resolveLnurlDirection } from '../services/lnurlService';
import { INVOICE_WITH_AMOUNT } from './bolt11TestVectors';

jest.mock('../components/BrandedAlert', () => ({ Alert: { alert: jest.fn() } }));
const lnurl = bech32.encode(
  'lnurl',
  bech32.toWords(new TextEncoder().encode('https://example.com/pay')),
  2000,
);
const npub = npubEncode('a'.repeat(64));
const payloads = [
  `lightning:${INVOICE_WITH_AMOUNT}`,
  'lightning:alice@example.com',
  `lightning:${lnurl}`,
  lnurl,
  'lnurlw://example.com/voucher',
  'lnurlp://example.com/pay',
  'lnurl://example.com/voucher',
  'lightning:https://example.com/pay',
  'bitcoin:bc1qexample?amount=0.001',
  `nostr:${npub}`,
  `nostr:${nprofileEncode({ pubkey: 'a'.repeat(64), relays: ['wss://example.com'] })}`,
];
const mockFetch = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = mockFetch;
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      tag: 'payRequest',
      callback: 'https://example.com/callback',
      minSendable: 1000,
      maxSendable: 1000,
      metadata: '[]',
    }),
  });
});
it.each(payloads)('presents confirmation before any network work for %s', (payload) => {
  confirmLinkAction(payload, () => {
    void fetch('https://example.com/confirmed');
  });
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  expect(mockFetch).not.toHaveBeenCalled();
  const buttons = jest.mocked(Alert.alert).mock.calls[0][2]!;
  buttons[1].onPress?.();
  expect(mockFetch).toHaveBeenCalledTimes(1);
  buttons[1].onPress?.();
  expect(mockFetch).toHaveBeenCalledTimes(1);
});
it('gates real LNURL resolution behind the confirm tap', async () => {
  let request: ReturnType<typeof resolveLnurlDirection> | undefined;
  confirmLinkAction(`lightning:${lnurl}`, () => {
    request = resolveLnurlDirection(lnurl);
  });
  expect(mockFetch).not.toHaveBeenCalled();
  jest.mocked(Alert.alert).mock.calls[0][2]![1].onPress?.();
  await expect(request).resolves.toMatchObject({ kind: 'pay' });
  expect(mockFetch).toHaveBeenCalledTimes(1);
});
it.each(['cancel', 'dismiss'])(
  'never resolves after %s, even through a stale confirm callback',
  (action) => {
    confirmLinkAction(lnurl, () => {
      void resolveLnurlDirection(lnurl);
    });
    const call = jest.mocked(Alert.alert).mock.calls[0];
    if (action === 'cancel') call[2]![0].onPress?.();
    else call[3]?.onDismiss?.();
    call[2]![1].onPress?.();
    expect(mockFetch).not.toHaveBeenCalled();
  },
);
it('describes only the host for endpoint links', () => {
  expect(linkActionDescription('lnurlw://example.com/private?token=fixture')).toBe(
    'Withdraw from example.com',
  );
  expect(linkActionDescription('lightning:https://example.com/pay')).toBe(
    'Open Lightning link from example.com',
  );
});
it('names a profile by its locally decoded npub', () => {
  expect(linkActionDescription(`nostr:${npub}`)).toBe(`Open profile ${npub.slice(0, 20)}…`);
});

it.each([
  '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
  '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy',
  'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
])('names the actual bare Bitcoin destination in consent: %s', (address) => {
  confirmLinkAction(address, jest.fn());
  expect(Alert.alert).toHaveBeenCalledWith(
    expect.any(String),
    `Pay ${address}`,
    expect.any(Array),
    expect.any(Object),
  );
  expect(mockFetch).not.toHaveBeenCalled();
});
