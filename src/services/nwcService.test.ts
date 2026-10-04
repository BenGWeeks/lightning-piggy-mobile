/**
 * Unit tests for the per-call `replyTimeoutMs` ceiling on
 * `nwcService.getBalance` (#133).
 *
 * The @getalby/sdk hardcodes a 10 s `replyTimeout` on `get_balance`,
 * which lets a single stalled relay reply add ~10 s of latency to the
 * post-payment refresh loop in WalletContext (1 s ticks). The fix is
 * an opt-in tighter timeout — these tests pin its behaviour:
 *  (a) honours the bound when the SDK call hangs,
 *  (b) returns the balance when the SDK call resolves under the bound,
 *  (c) preserves the existing 2-attempt retry on transient failure.
 */

// Mock @getalby/sdk so we can drive `provider.getBalance()` without
// real Nostr relays. The mock provider stores a configurable
// implementation that each test swaps in.
let mockGetBalanceImpl: () => Promise<{ balance: number }> = async () => ({ balance: 0 });
const mockEnable = jest.fn(async () => undefined);
// pay_invoice + lookupInvoice are driven per-test for the ambiguous
// "unknown Error" outcome path (#891). Defaults are benign so the existing
// getBalance/connection tests are unaffected. The mock client deliberately
// omits `executeNip47Request`, so sendPaymentWithTimeout takes the public
// `provider.sendPayment` fallback — which is what these impls stub.
let mockSendPaymentImpl: (bolt11: string) => Promise<{ preimage: string }> = async () => ({
  preimage: 'p'.repeat(64),
});
let mockLookupInvoiceImpl: (args: { paymentHash: string }) => Promise<{
  paid?: boolean;
  preimage?: string;
}> = async () => ({ paid: false });

jest.mock('@getalby/sdk', () => ({
  NostrWebLNProvider: jest.fn().mockImplementation(() => ({
    enable: mockEnable,
    getBalance: () => mockGetBalanceImpl(),
    sendPayment: (bolt11: string) => mockSendPaymentImpl(bolt11),
    lookupInvoice: (args: { paymentHash: string }) => mockLookupInvoiceImpl(args),
    close: jest.fn(),
    // `client.connected` is read by ensureConnected(); make it look
    // healthy so the reconnect path isn't triggered mid-test.
    client: { connected: true, pool: undefined },
  })),
}));

import {
  connect,
  disconnect,
  getBalance,
  isConnectionError,
  isReplyTimeoutError,
  isWalletConnected,
  payInvoice,
} from './nwcService';

const VALID_NWC_URL =
  'nostr+walletconnect://' +
  'a'.repeat(64) +
  '?relay=wss%3A%2F%2Frelay.example.com&secret=' +
  'b'.repeat(64);
const WALLET_ID = 'test-wallet-1';

beforeEach(async () => {
  // Async timer advancement lets Promise continuations schedule retry timers
  // before the fake clock advances; synchronous runAllTimers would miss them.
  jest.useFakeTimers();
  // Cheap successful balance for the connect()'s initial getBalance.
  mockGetBalanceImpl = async () => ({ balance: 0 });
  mockSendPaymentImpl = async () => ({ preimage: 'p'.repeat(64) });
  mockLookupInvoiceImpl = async () => ({ paid: false });
  const connection = connect(WALLET_ID, VALID_NWC_URL);
  await jest.runAllTimersAsync();
  const result = await connection;
  expect(result.success).toBe(true);
});

afterEach(() => {
  disconnect(WALLET_ID);
  try {
    // Successful replies and fired timeouts must clean up their timers.
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});

describe('nwcService.getBalance with replyTimeoutMs', () => {
  it('returns the balance when the SDK responds within the bound', async () => {
    mockGetBalanceImpl = async () => ({ balance: 4242 });
    const balance = await getBalance(WALLET_ID, { replyTimeoutMs: 2500 });
    expect(balance).toBe(4242);
  });

  it('gives up within the timeout when the SDK call hangs', async () => {
    // Pending forever — simulates a relay that never replies.
    mockGetBalanceImpl = () => new Promise(() => {});

    const pending = getBalance(WALLET_ID, { replyTimeoutMs: 200 });
    let settled = false;
    void pending.then(() => {
      settled = true;
    });

    // Flush ensureConnected / Promise continuations before checking the exact
    // deadline: one attempt, no retry, and no early timeout.
    await jest.advanceTimersByTimeAsync(199);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(await pending).toBeNull();
    expect(settled).toBe(true);
  });

  it('does NOT retry on transient failure when replyTimeoutMs is set (true ceiling)', async () => {
    // With replyTimeoutMs set, attempts=1 — a transient failure on the single attempt surfaces as a null balance rather than triggering a retry that could exceed the budget.
    let calls = 0;
    mockGetBalanceImpl = async () => {
      calls++;
      throw new Error('reply timeout: event abc');
    };

    const balance = await getBalance(WALLET_ID, { replyTimeoutMs: 2500 });
    expect(balance).toBeNull();
    expect(calls).toBe(1);
  });

  it('falls back to the SDK default timeout when no option is given', async () => {
    // Without replyTimeoutMs, the call must reach the SDK directly — no withTimeout wrapper. Easiest pin: a fast resolve still works and the value is returned unchanged.
    mockGetBalanceImpl = async () => ({ balance: 7 });
    const balance = await getBalance(WALLET_ID);
    expect(balance).toBe(7);
  });

  it('retries on transient failure when replyTimeoutMs is NOT set (default path keeps the 2-attempt loop)', async () => {
    // Without replyTimeoutMs, attempts=2 with 1500 ms backoff between them.
    let calls = 0;
    mockGetBalanceImpl = async () => {
      calls++;
      if (calls === 1) throw new Error('reply timeout: event abc');
      return { balance: 999 };
    };

    const pending = getBalance(WALLET_ID);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await jest.advanceTimersByTimeAsync(1499);
    expect(calls).toBe(1);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(await pending).toBe(999);
    expect(calls).toBe(2);
  });

  it('stops after two failed attempts on the default path', async () => {
    const failedBalance = jest.fn(async () => {
      throw new Error('reply timeout: event abc');
    });
    mockGetBalanceImpl = failedBalance;
    const pending = getBalance(WALLET_ID);

    await jest.advanceTimersByTimeAsync(1499);
    expect(failedBalance).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(await pending).toBeNull();
    expect(failedBalance).toHaveBeenCalledTimes(2);
    // Advancing beyond a possible third backoff must not issue another call.
    await jest.advanceTimersByTimeAsync(3000);
    expect(failedBalance).toHaveBeenCalledTimes(2);
  });
});

describe('isConnectionError (#648 — connection-lost vs confirmed failure)', () => {
  it.each([
    'Failed to connect to wss://relay.coinos.io',
    'failed to connect to any relay',
    'publish timed out',
    "Couldn't reach your wallet: relay publish timed out",
    '[NWC] Relay publish failed',
    'Network request failed',
    'WebSocket connection closed',
    'connection lost',
  ])('treats %j as a connectivity (unknown-outcome) error', (msg) => {
    expect(isConnectionError(new Error(msg))).toBe(true);
  });

  it.each(['Insufficient funds', 'invoice expired', 'no route', 'payment failed'])(
    'does NOT treat %j (a confirmed wallet error) as a connection error',
    (msg) => {
      expect(isConnectionError(new Error(msg))).toBe(false);
    },
  );

  it('a connection error is distinct from a reply-timeout', () => {
    const connErr = new Error('Failed to connect to wss://relay.coinos.io');
    expect(isConnectionError(connErr)).toBe(true);
    expect(isReplyTimeoutError(connErr)).toBe(false);
  });
});

describe('isWalletConnected (#654 — relay responsiveness, not just transport)', () => {
  // beforeEach connect()s with a responsive mock relay, so we start "connected".
  // We use replyTimeoutMs so each failing getBalance gives up immediately
  // (single attempt, no retry/backoff) and records exactly one outcome.
  const failConnect = async () => {
    throw new Error('Failed to connect to wss://relay.example.com');
  };

  it('is true after a fresh connect with a responsive relay', () => {
    expect(isWalletConnected(WALLET_ID)).toBe(true);
  });

  it('flips to false only after a run of unanswered (connection-error) requests', async () => {
    mockGetBalanceImpl = failConnect;
    await getBalance(WALLET_ID, { replyTimeoutMs: 2500 });
    await getBalance(WALLET_ID, { replyTimeoutMs: 2500 });
    expect(isWalletConnected(WALLET_ID)).toBe(true); // 2 failures < threshold (3)
    await getBalance(WALLET_ID, { replyTimeoutMs: 2500 });
    expect(isWalletConnected(WALLET_ID)).toBe(false); // 3rd → relay considered dead
  });

  it('recovers to true as soon as the relay answers again', async () => {
    mockGetBalanceImpl = failConnect;
    await getBalance(WALLET_ID, { replyTimeoutMs: 2500 });
    await getBalance(WALLET_ID, { replyTimeoutMs: 2500 });
    await getBalance(WALLET_ID, { replyTimeoutMs: 2500 });
    expect(isWalletConnected(WALLET_ID)).toBe(false);
    mockGetBalanceImpl = async () => ({ balance: 42 });
    await getBalance(WALLET_ID, { replyTimeoutMs: 2500 });
    expect(isWalletConnected(WALLET_ID)).toBe(true);
  });

  it('flips to false when the relay HANGS (withTimeout fires) — the primary "relay hung" case', async () => {
    // A hung relay: getBalance never resolves, so withTimeout rejects with a
    // ReplyTimeoutError. That must count toward relay-dead, not reset the
    // counter — a generic Error used to slip through both matchers (#654 review).
    mockGetBalanceImpl = () => new Promise(() => {});
    const timeout = async () => {
      const pending = getBalance(WALLET_ID, { replyTimeoutMs: 150 });
      await jest.advanceTimersByTimeAsync(150);
      expect(await pending).toBeNull();
    };
    await timeout();
    await timeout();
    expect(isWalletConnected(WALLET_ID)).toBe(true); // 2 failures < threshold (3)
    await timeout();
    expect(isWalletConnected(WALLET_ID)).toBe(false); // 3rd timeout → dead
  });

  it('does NOT mark a relay dead when the wallet answers with a non-connection error (e.g. a get_balance-less wallet)', async () => {
    // "method not supported" is the relay/wallet *answering* — capability-
    // agnostic: it must never be misread as a dead relay (#654).
    mockGetBalanceImpl = async () => {
      throw new Error('method not supported');
    };
    await getBalance(WALLET_ID, { replyTimeoutMs: 2500 });
    await getBalance(WALLET_ID, { replyTimeoutMs: 2500 });
    await getBalance(WALLET_ID, { replyTimeoutMs: 2500 });
    await getBalance(WALLET_ID, { replyTimeoutMs: 2500 });
    expect(isWalletConnected(WALLET_ID)).toBe(true);
  });
});

// NB: the relay cooldown / rate-limit back-off internals now live in
// `nwcRelayHealth.ts` and are covered directly in `nwcRelayHealth.test.ts`
// (#785). The service-level behaviour that relay-health drives — e.g.
// `isWalletConnected` flipping after a run of unanswered requests — stays
// tested above through the mocked provider.

describe('nwcService.payInvoice — ambiguous "unknown Error" outcome (#891)', () => {
  // A canonical BOLT11 test vector so extractPaymentHash() returns a hash
  // and the disambiguation branch runs (payment_hash 000102…0102).
  const BOLT11 =
    'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsy' +
    'p3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4e' +
    'vs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp';

  // The reproduced #891 failure: NWC pay_invoice surfaces the Alby-SDK
  // "unknown Error"/INTERNAL wrap, and the one-shot lookup FALSELY reports
  // unpaid (verified live — the LN balance had already dropped). The
  // payment status is genuinely UNKNOWN, so payInvoice must throw a
  // ReplyTimeoutError (→ "Still in flight" UX), NOT a hard failure that
  // callers render as "Payment failed" and the user retries into a double-pay.
  it('throws a ReplyTimeoutError (status-unknown), not a hard failure, when the lookup cannot confirm paid', async () => {
    mockSendPaymentImpl = async () => {
      throw Object.assign(new Error('unknown Error'), { code: 'INTERNAL' });
    };
    mockLookupInvoiceImpl = async () => ({ paid: false });

    let thrown: unknown;
    try {
      await payInvoice(WALLET_ID, BOLT11);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    expect(isReplyTimeoutError(thrown)).toBe(true);
  });

  // The happy disambiguation: the wallet DID settle and the lookup confirms
  // it (paid + preimage) — payInvoice recovers the preimage and succeeds,
  // so the "unknown Error" wrap never reaches the user.
  it('returns the preimage when the lookup confirms the payment settled', async () => {
    const preimage = 'a'.repeat(64);
    mockSendPaymentImpl = async () => {
      throw Object.assign(new Error('unknown Error'), { code: 'INTERNAL' });
    };
    mockLookupInvoiceImpl = async () => ({ paid: true, preimage });

    await expect(payInvoice(WALLET_ID, BOLT11)).resolves.toEqual({ preimage });
  });
});
