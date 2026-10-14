import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useSellerInvoice } from './useSellerInvoice';
import { useNostr } from '../contexts/NostrContext';
import { useWallet } from '../contexts/WalletContext';
import { lookupInvoice } from '../services/nwcService';
import { sendNip17Rumor } from '../services/nip17RumorSend';
import { loadSellerInvoices } from '../services/sellerInvoiceStore';
import { loadSellerReceiveWallet } from '../services/sellerReceiveWallet';
import { amountSatsFromBolt11, paymentHashFromBolt11 } from '../utils/bolt11';

jest.mock('../contexts/LocaleContext', () => ({ useTranslation: () => (key: string) => key }));

jest.mock('../contexts/NostrContext', () => ({ useNostr: jest.fn() }));
jest.mock('../contexts/WalletContext', () => ({ useWallet: jest.fn() }));
jest.mock('../services/nwcService', () => ({ lookupInvoice: jest.fn() }));
jest.mock('../services/nip17RumorSend', () => {
  const actual = jest.requireActual('../services/nip17RumorSend');
  return { ...actual, sendNip17Rumor: jest.fn() };
});
jest.mock('../utils/bolt11', () => ({
  amountSatsFromBolt11: jest.fn(),
  paymentHashFromBolt11: jest.fn(),
}));
jest.mock('../utils/messageContent', () => ({
  extractInvoice: () => ({ expiresAt: 1_800_000_000 }),
}));

const SELLER = 'a'.repeat(64);
const BUYER = 'b'.repeat(64);
const BOLT11 = `lnbc42u1${'q'.repeat(80)}`;
const HASH = 'c'.repeat(64);
const makeInvoiceForWallet = jest.fn();

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  (useNostr as jest.Mock).mockReturnValue({ pubkey: SELLER, signerType: 'nsec', relays: [] });
  (useWallet as jest.Mock).mockReturnValue({
    // The ACTIVE wallet is 'spending' — invoices must not land there implicitly.
    activeWalletId: 'spending',
    makeInvoice: jest.fn(),
    makeInvoiceForWallet,
  });
  makeInvoiceForWallet.mockResolvedValue(BOLT11);
  (amountSatsFromBolt11 as jest.Mock).mockReturnValue(4200);
  (paymentHashFromBolt11 as jest.Mock).mockReturnValue(HASH);
  (sendNip17Rumor as jest.Mock).mockResolvedValue(undefined);
  (lookupInvoice as jest.Mock).mockResolvedValue({ paid: false });
});

it('creates the invoice on the CHOSEN wallet and sends a Gamma type-2 payment request', async () => {
  const { result } = renderHook(() => useSellerInvoice(BUYER, 'order-1'));
  await act(async () => {
    await result.current.sendInvoice({
      walletId: 'shop-wallet',
      amountSats: 4200,
      remember: false,
    });
  });
  expect(makeInvoiceForWallet).toHaveBeenCalledWith('shop-wallet', 4200, expect.any(String));
  const first = (sendNip17Rumor as jest.Mock).mock.calls[0][0];
  expect(first).toMatchObject({ senderPubkey: SELLER, recipientPubkey: BUYER });
  expect(first.rumor.kind).toBe(16);
  expect(first.rumor.tags).toEqual(
    expect.arrayContaining([
      ['type', '2'],
      ['order', 'order-1'],
      ['amount', '4200'],
      ['payment', 'lightning', BOLT11],
    ]),
  );
  const records = await loadSellerInvoices(SELLER);
  expect(records[`${BUYER}:order-1`]).toMatchObject({ walletId: 'shop-wallet', paymentHash: HASH });
  // Not remembered unless asked.
  expect(await loadSellerReceiveWallet(SELLER)).toBeNull();
});

it('"Remember for my shop" saves the chosen wallet', async () => {
  const { result } = renderHook(() => useSellerInvoice(BUYER, 'order-1'));
  await act(async () => {
    await result.current.sendInvoice({ walletId: 'shop-wallet', amountSats: 4200, remember: true });
  });
  expect(await loadSellerReceiveWallet(SELLER)).toBe('shop-wallet');
});

it('refuses to send an invoice for a different amount than the computed total', async () => {
  (amountSatsFromBolt11 as jest.Mock).mockReturnValue(4199);
  const { result } = renderHook(() => useSellerInvoice(BUYER, 'order-1'));
  await act(async () => {
    await expect(
      result.current.sendInvoice({ walletId: 'shop-wallet', amountSats: 4200, remember: false }),
    ).rejects.toMatchObject({ code: 'amountMismatch' });
  });
  expect(sendNip17Rumor).not.toHaveBeenCalled();
});

it('watches the wallet the invoice was made on — not the active one — and marks paid', async () => {
  const { result } = renderHook(() => useSellerInvoice(BUYER, 'order-1'));
  await act(async () => {
    await result.current.sendInvoice({
      walletId: 'shop-wallet',
      amountSats: 4200,
      remember: false,
    });
  });
  await waitFor(() => expect(result.current.record?.walletId).toBe('shop-wallet'));
  (lookupInvoice as jest.Mock).mockResolvedValue({ paid: true });
  await act(async () => {
    expect(await result.current.checkPaid()).toBe(true);
  });
  expect(lookupInvoice).toHaveBeenCalledWith('shop-wallet', HASH, expect.anything());
  expect(lookupInvoice).not.toHaveBeenCalledWith('spending', expect.anything(), expect.anything());
  await waitFor(() => expect(result.current.record?.paidAt).toBeDefined());

  await act(async () => {
    await result.current.markPaid();
  });
  const status = (sendNip17Rumor as jest.Mock).mock.calls.at(-1)![0].rumor;
  expect(status.tags).toEqual(
    expect.arrayContaining([
      ['type', '3'],
      ['status', 'confirmed'],
    ]),
  );
});
