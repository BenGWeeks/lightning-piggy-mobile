import { act, renderHook } from '@testing-library/react-native';
import { useMarketCheckout } from './useMarketCheckout';
import { useNostr } from '../contexts/NostrContext';
import * as nostrService from '../services/nostrService';
import * as nostrConnectService from '../services/nostrConnectService';

jest.mock('../contexts/NostrContext', () => ({ useNostr: jest.fn() }));
jest.mock('../contexts/LocaleContext', () => ({ useTranslation: () => (key: string) => key }));
jest.mock('../services/amberService', () => ({}));
jest.mock('../services/nostrConnectService', () => ({
  requestNip44Encrypt: jest.fn(),
  requestEventSignature: jest.fn(),
}));
jest.mock('../services/nostrService', () => ({
  DEFAULT_RELAYS: ['wss://relay.example'],
  sendNip17ToManyWithSigner: jest.fn(),
}));

const buyer = 'a'.repeat(64);
const vendor = 'b'.repeat(64);
const input = { vendorPubkey: vendor, dTag: 'item', priceSats: 100, quantity: 1 };

beforeEach(() => {
  jest.clearAllMocks();
  (useNostr as jest.Mock).mockReturnValue({
    pubkey: buyer,
    isLoggedIn: true,
    signerType: 'nip46',
    relays: [],
  });
  (nostrConnectService.requestNip44Encrypt as jest.Mock).mockResolvedValue('ciphertext');
  (nostrConnectService.requestEventSignature as jest.Mock).mockResolvedValue({
    event: JSON.stringify({ kind: 13, sig: 'signature' }),
  });
  (nostrService.sendNip17ToManyWithSigner as jest.Mock).mockImplementation(async (options) => {
    await options.signerNip44Encrypt('plaintext', vendor);
    await options.signerSignSeal({ kind: 13, pubkey: buyer });
    return { delivery: { delivered: true }, errors: [] };
  });
});

test('NIP-46 checkout encrypts and signs with the logged-in buyer and sends the order', async () => {
  const { result } = renderHook(() => useMarketCheckout());
  expect(result.current.canOrder).toBe(true);
  await act(async () => {
    await result.current.placeOrder(input);
  });
  expect(nostrConnectService.requestNip44Encrypt).toHaveBeenCalledWith('plaintext', vendor, buyer);
  expect(nostrConnectService.requestEventSignature).toHaveBeenCalledWith(
    JSON.stringify({ kind: 13, pubkey: buyer }),
    '',
    buyer,
  );
  expect(nostrService.sendNip17ToManyWithSigner).toHaveBeenCalledWith(
    expect.objectContaining({
      senderPubkey: buyer,
      recipientPubkeys: [vendor],
    }),
  );
  expect(result.current.status).toBe('sent');
});

test('an empty NIP-46 signature fails checkout instead of reporting delivery', async () => {
  (nostrConnectService.requestEventSignature as jest.Mock).mockResolvedValue({ event: '' });
  const { result } = renderHook(() => useMarketCheckout());
  await act(async () => {
    await expect(result.current.placeOrder(input)).rejects.toThrow('empty signed seal');
  });
  expect(result.current.status).toBe('error');
});

test('unsupported signers cannot enter checkout', () => {
  (useNostr as jest.Mock).mockReturnValue({
    pubkey: buyer,
    isLoggedIn: true,
    signerType: null,
    relays: [],
  });
  expect(renderHook(() => useMarketCheckout()).result.current.canOrder).toBe(false);
});
