import type { NostrWebLNProvider } from '@getalby/sdk';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { confirmNwcPayment } from './nwcPaymentCompletion';

const preimage = 'ab'.repeat(32);
const paymentHash = bytesToHex(sha256(hexToBytes(preimage)));
const pendingReply = () => new Promise<{ preimage: string }>(() => {});
const onReplyError = (error: unknown) => {
  throw error;
};
beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});

it('uses raw lookup with a short SDK reply timeout and accepts settled_at', async () => {
  const executeNip47Request = jest.fn(async () => ({ settled_at: 123, preimage }));
  const provider = { client: { executeNip47Request } } as unknown as NostrWebLNProvider;
  const result = confirmNwcPayment({ provider, paymentHash, reply: pendingReply, onReplyError });
  await jest.advanceTimersByTimeAsync(3000);
  await expect(result).resolves.toEqual({ preimage, confirmed: true });
  expect(executeNip47Request).toHaveBeenCalledWith(
    'lookup_invoice',
    { payment_hash: paymentHash },
    expect.any(Function),
    { replyTimeout: 2500 },
  );
});

it('bounds a hanging public lookup and continues the backoff', async () => {
  const lookupInvoice = jest
    .fn()
    .mockImplementationOnce(() => new Promise(() => {}))
    .mockResolvedValueOnce({ paid: true, preimage });
  const provider = { client: {}, lookupInvoice } as unknown as NostrWebLNProvider;
  const result = confirmNwcPayment({ provider, paymentHash, reply: pendingReply, onReplyError });
  await jest.advanceTimersByTimeAsync(10500);
  await expect(result).resolves.toEqual({ preimage, confirmed: true });
  expect(lookupInvoice).toHaveBeenCalledTimes(2);
});

it('clears the public lookup timeout when cancellation wins', async () => {
  const lookupInvoice = jest.fn(() => new Promise(() => {}));
  const provider = { client: {}, lookupInvoice } as unknown as NostrWebLNProvider;
  const controller = new AbortController();
  const result = confirmNwcPayment({
    provider,
    paymentHash,
    reply: pendingReply,
    onReplyError,
    signal: controller.signal,
  });
  const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  await jest.advanceTimersByTimeAsync(3000);
  controller.abort();
  await assertion;
});
