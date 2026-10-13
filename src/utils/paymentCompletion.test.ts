import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { completePayment, PaymentCandidate } from './paymentCompletion';

const preimage = 'ab'.repeat(32);
const paymentHash = bytesToHex(sha256(hexToBytes(preimage)));
const pending = () => new Promise<PaymentCandidate>(() => {});
const timeoutError = () => new Error('Payment status unknown');
const defaults = {
  paymentHash,
  reply: pending,
  lookup: pending,
  timeoutError,
  onReplyError: (error: unknown) => {
    throw error;
  },
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});

it('reply wins and cancels scheduled polls', async () => {
  const lookup = jest.fn(pending);
  await expect(
    completePayment({ ...defaults, lookup, reply: async () => ({ preimage }) }),
  ).resolves.toMatchObject({ preimage, source: 'reply' });
  expect(lookup).not.toHaveBeenCalled();
});

it('notification wins, closes the subscription and ignores the late reply', async () => {
  const close = jest.fn();
  let notify!: (candidate: PaymentCandidate) => void;
  let reply!: (candidate: PaymentCandidate) => void;
  const result = completePayment({
    ...defaults,
    reply: () =>
      new Promise((resolve) => {
        reply = resolve;
      }),
    subscribe: async (accept) => {
      notify = accept;
      return close;
    },
  });
  await Promise.resolve();
  notify({ preimage });
  await expect(result).resolves.toMatchObject({ source: 'notification' });
  reply({ preimage });
  expect(close).toHaveBeenCalledTimes(1);
});

it.each([{ paid: true }, { state: 'settled' }, { settled_at: 123 }])(
  'settled lookup wins (%j)',
  async (settlement) => {
    const result = completePayment({
      ...defaults,
      lookup: async () => ({ preimage, ...settlement }),
    });
    await jest.advanceTimersByTimeAsync(3000);
    await expect(result).resolves.toMatchObject({ source: 'lookup', elapsedMs: 3000 });
  },
);

it('ignores an unpaid lookup preimage and backs off before accepting settlement', async () => {
  const lookup = jest
    .fn()
    .mockResolvedValueOnce({ preimage, paid: false })
    .mockResolvedValueOnce({ preimage, paid: true });
  const result = completePayment({ ...defaults, lookup });
  await jest.advanceTimersByTimeAsync(7999);
  expect(lookup).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1);
  await expect(result).resolves.toMatchObject({ source: 'lookup', elapsedMs: 8000 });
});

it('verify wins only on settled true', async () => {
  const verify = jest
    .fn()
    .mockResolvedValueOnce({ settled: false, preimage })
    .mockResolvedValueOnce({ settled: true, preimage });
  const result = completePayment({ ...defaults, verify });
  await jest.advanceTimersByTimeAsync(8000);
  await expect(result).resolves.toMatchObject({ source: 'verify' });
});

it('ignores mismatched and malformed preimages from every source', async () => {
  const result = completePayment({
    ...defaults,
    reply: async () => ({ preimage: '00'.repeat(32) }),
    subscribe: async (accept) => {
      accept({ preimage: 'invalid' });
      return () => {};
    },
    lookup: jest
      .fn()
      .mockResolvedValueOnce({ preimage: '00'.repeat(32), paid: true })
      .mockResolvedValue({ preimage, paid: true }),
    verify: async () => ({ preimage: '00'.repeat(32), settled: true }),
  });
  await jest.advanceTimersByTimeAsync(8000);
  await expect(result).resolves.toMatchObject({ source: 'lookup' });
});

it('all sources failing exhaust the 90 second budget', async () => {
  const result = completePayment({
    ...defaults,
    reply: async () => {
      throw new Error('reply timeout');
    },
    onReplyError: () => {},
    lookup: async () => {
      throw new Error('lookup failed');
    },
    verify: async () => {
      throw new Error('verify failed');
    },
    subscribe: async () => {
      throw new Error('not supported');
    },
  });
  const assertion = expect(result).rejects.toThrow('Payment status unknown');
  await jest.advanceTimersByTimeAsync(90000);
  await assertion;
});

it('terminal reply failures surface immediately and stop other sources', async () => {
  const result = completePayment({
    ...defaults,
    reply: async () => {
      throw new Error('insufficient balance');
    },
  });
  await expect(result).rejects.toThrow('insufficient balance');
});

it('aborts in-flight losers and closes a subscription that finishes setting up late', async () => {
  let lookupSignal!: AbortSignal;
  let closeSubscription!: (close: () => void) => void;
  let accept!: (candidate: PaymentCandidate) => void;
  const close = jest.fn();
  const result = completePayment({
    ...defaults,
    lookup: (signal) => {
      lookupSignal = signal;
      return pending();
    },
    subscribe: (notify) => {
      accept = notify;
      return new Promise((resolve) => {
        closeSubscription = resolve;
      });
    },
    verify: async () => ({ preimage, settled: true }),
  });
  await jest.advanceTimersByTimeAsync(3000);
  await expect(result).resolves.toMatchObject({ source: 'verify' });
  expect(lookupSignal.aborted).toBe(true);
  closeSubscription(close);
  await Promise.resolve();
  accept({ preimage });
  expect(close).toHaveBeenCalledTimes(1);
});

it('user cancellation stops waiting for a stalled reply', async () => {
  const controller = new AbortController();
  const result = completePayment({ ...defaults, signal: controller.signal });
  const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await assertion;
});
