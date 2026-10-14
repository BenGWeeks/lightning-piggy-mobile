import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useSellerInvoice } from './useSellerInvoice';
import { useNostr } from '../contexts/NostrContext';
import { useWallet } from '../contexts/WalletContext';
import { lookupInvoice } from '../services/nwcService';
import { sendNip17Rumor } from '../services/nip17RumorSend';
import { loadSellerInvoices, recordSellerInvoice } from '../services/sellerInvoiceStore';
import { loadSellerReceiveWallet } from '../services/sellerReceiveWallet';
import { extractInvoice } from '../utils/messageContent';
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
  extractInvoice: jest.fn(() => ({ expiresAt: 1_800_000_000 })),
}));

const SELLER = 'a'.repeat(64);
const BUYER = 'b'.repeat(64);
const BOLT11 = `lnbc42u1${'q'.repeat(80)}`;
const HASH = 'c'.repeat(64);
const makeInvoiceForWallet = jest.fn();

beforeEach(async () => {
  jest.clearAllMocks();
  (extractInvoice as jest.Mock).mockReturnValue({ expiresAt: 1_800_000_000 });
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

it.each(['unpaid', 'paid', 'unknown', 'live'])(
  'checks the old invoice before replacement: %s',
  async (state) => {
    (extractInvoice as jest.Mock).mockReturnValue({
      expiresAt: state === 'live' ? Date.now() / 1000 + 3600 : 1,
    });
    await recordSellerInvoice(SELLER, {
      orderId: 'order-1',
      buyerPubkey: BUYER,
      walletId: 'old-wallet',
      paymentHash: HASH,
      bolt11: BOLT11,
      amountSats: 4200,
      sentAt: 1,
    });
    (lookupInvoice as jest.Mock).mockResolvedValue(
      state === 'unknown' ? null : { paid: state === 'paid' },
    );
    const { result } = renderHook(() => useSellerInvoice(BUYER, 'order-1'));
    await act(async () => {
      const action = result.current.sendInvoice({
        walletId: 'new-wallet',
        amountSats: 4200,
        remember: false,
      });
      if (state === 'unpaid') await action;
      else await expect(action).rejects.toMatchObject({ code: 'invoiceFailed' });
    });
    if (state === 'unpaid') {
      expect(lookupInvoice).toHaveBeenCalledWith('old-wallet', HASH, expect.anything());
      expect(makeInvoiceForWallet).toHaveBeenCalledWith('new-wallet', 4200, expect.any(String));
      expect(sendNip17Rumor).toHaveBeenCalledTimes(1);
    } else {
      expect(makeInvoiceForWallet).not.toHaveBeenCalled();
      expect(sendNip17Rumor).not.toHaveBeenCalled();
    }
    if (state === 'paid')
      expect((await loadSellerInvoices(SELLER))[`${BUYER}:order-1`].paidAt).toBeDefined();
  },
);

it('persists the validated invoice before publishing and fails closed on a record write error', async () => {
  const { result } = renderHook(() => useSellerInvoice(BUYER, 'order-1'));
  (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk'));
  await act(async () => {
    await expect(
      result.current.sendInvoice({ walletId: 'shop-wallet', amountSats: 4200, remember: false }),
    ).rejects.toThrow('disk');
  });
  expect(sendNip17Rumor).not.toHaveBeenCalled();
  (sendNip17Rumor as jest.Mock).mockImplementationOnce(async () => {
    expect((await loadSellerInvoices(SELLER))[`${BUYER}:order-1`]).toMatchObject({
      walletId: 'shop-wallet',
      bolt11: BOLT11,
      paymentHash: HASH,
      deliveryPending: true,
    });
  });
  await act(async () => {
    await result.current.sendInvoice({
      walletId: 'shop-wallet',
      amountSats: 4200,
      remember: false,
    });
  });
});

it('reuses an undelivered invoice and its original wallet after remount', async () => {
  (sendNip17Rumor as jest.Mock).mockRejectedValueOnce(new Error('relay unavailable'));
  const first = renderHook(() => useSellerInvoice(BUYER, 'order-1'));
  await act(async () => {
    await expect(
      first.result.current.sendInvoice({
        walletId: 'shop-wallet',
        amountSats: 4200,
        remember: false,
      }),
    ).rejects.toMatchObject({ code: 'sendFailed' });
  });
  first.unmount();
  const { result } = renderHook(() => useSellerInvoice(BUYER, 'order-1'));
  await act(async () => {
    await expect(
      result.current.sendInvoice({ walletId: 'other-wallet', amountSats: 5000, remember: true }),
    ).rejects.toMatchObject({ code: 'amountMismatch' });
    await result.current.sendInvoice({
      walletId: 'other-wallet',
      amountSats: 4200,
      remember: true,
    });
  });
  expect(makeInvoiceForWallet).toHaveBeenCalledTimes(1);
  expect((sendNip17Rumor as jest.Mock).mock.calls[1][0].rumor).toEqual(
    (sendNip17Rumor as jest.Mock).mock.calls[0][0].rumor,
  );
  expect((await loadSellerInvoices(SELLER))[`${BUYER}:order-1`]).toMatchObject({
    walletId: 'shop-wallet',
    deliveryPending: false,
  });
  expect(await loadSellerReceiveWallet(SELLER)).toBe('shop-wallet');
});

it('keeps the same payable invoice when delivery succeeds but the completion write fails', async () => {
  const originalWrite = (AsyncStorage.setItem as jest.Mock).getMockImplementation()!;
  const write = (AsyncStorage.setItem as jest.Mock).mockImplementation((key, value) => {
    if (key === `market-seller-invoices:${SELLER}` && value.includes('"deliveryPending":false'))
      return Promise.reject(new Error('disk after send'));
    return originalWrite(key, value);
  });
  const { result } = renderHook(() => useSellerInvoice(BUYER, 'order-1'));
  await act(async () => {
    await expect(
      result.current.sendInvoice({ walletId: 'shop-wallet', amountSats: 4200, remember: false }),
    ).rejects.toThrow('disk after send');
  });
  expect((await loadSellerInvoices(SELLER))[`${BUYER}:order-1`]).toMatchObject({
    walletId: 'shop-wallet',
    paymentHash: HASH,
    bolt11: BOLT11,
  });
  write.mockImplementation(originalWrite);
  await act(async () => {
    await result.current.sendInvoice({
      walletId: 'other-wallet',
      amountSats: 4200,
      remember: false,
    });
  });
  expect(makeInvoiceForWallet).toHaveBeenCalledTimes(1);
  expect(sendNip17Rumor).toHaveBeenCalledTimes(2);
  expect((sendNip17Rumor as jest.Mock).mock.calls[1][0].rumor.tags).toEqual(
    (sendNip17Rumor as jest.Mock).mock.calls[0][0].rumor.tags,
  );
});

it.each([false, true])(
  'serializes creation across instances, including unmount: %s',
  async (unmount) => {
    let resolveInvoice!: (invoice: string) => void;
    makeInvoiceForWallet.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveInvoice = resolve;
        }),
    );
    const first = renderHook(() => useSellerInvoice(BUYER, 'order-1'));
    let firstAction!: Promise<void>;
    act(() => {
      firstAction = first.result.current.sendInvoice({
        walletId: 'original-wallet',
        amountSats: 4200,
        remember: false,
      });
    });
    // Attach the rejection handler before cancelling the old instance.
    const outcome = firstAction.catch((error) => error);
    await waitFor(() => expect(makeInvoiceForWallet).toHaveBeenCalledTimes(1));
    if (unmount) first.unmount();
    const second = renderHook(() => useSellerInvoice(BUYER, 'order-1'));
    let secondAction!: Promise<void>;
    act(() => {
      secondAction = second.result.current.sendInvoice({
        walletId: 'other-wallet',
        amountSats: 4200,
        remember: false,
      });
    });
    const secondOutcome = secondAction.catch((error) => error);
    await act(async () => {
      resolveInvoice(BOLT11);
      const firstResult = await outcome;
      const secondResult = await secondOutcome;
      if (unmount) {
        expect(firstResult).toMatchObject({ code: 'notSignedIn' });
        expect(secondResult).toBeUndefined();
      } else {
        expect(firstResult).toBeUndefined();
        expect(secondResult).toMatchObject({ code: 'invoiceFailed' });
      }
    });
    expect(makeInvoiceForWallet).toHaveBeenCalledTimes(1);
    expect(sendNip17Rumor).toHaveBeenCalledTimes(1);
    expect((await loadSellerInvoices(SELLER))[`${BUYER}:order-1`]).toMatchObject({
      walletId: 'original-wallet',
      deliveryPending: false,
    });
  },
);

it('does not create an invoice when the store read fails', async () => {
  const { result } = renderHook(() => useSellerInvoice(BUYER, 'order-1'));
  await act(async () => {
    await Promise.resolve();
  });
  (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('read failed'));
  await act(async () => {
    await expect(
      result.current.sendInvoice({ walletId: 'wallet', amountSats: 4200, remember: false }),
    ).rejects.toThrow('read failed');
  });
  expect(makeInvoiceForWallet).not.toHaveBeenCalled();
  expect(sendNip17Rumor).not.toHaveBeenCalled();
});
