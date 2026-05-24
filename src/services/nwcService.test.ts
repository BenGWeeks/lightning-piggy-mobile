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

jest.mock('@getalby/sdk', () => ({
  NostrWebLNProvider: jest.fn().mockImplementation(() => ({
    enable: mockEnable,
    getBalance: () => mockGetBalanceImpl(),
    close: jest.fn(),
    // `client.connected` is read by ensureConnected(); make it look
    // healthy so the reconnect path isn't triggered mid-test.
    client: { connected: true, pool: undefined },
  })),
}));

import {
  connect,
  getBalance,
  isConnectionError,
  isReplyTimeoutError,
  isWalletConnected,
} from './nwcService';

const VALID_NWC_URL =
  'nostr+walletconnect://' +
  'a'.repeat(64) +
  '?relay=wss%3A%2F%2Frelay.example.com&secret=' +
  'b'.repeat(64);
const WALLET_ID = 'test-wallet-1';

beforeEach(async () => {
  jest.useRealTimers();
  // Cheap successful balance for the connect()'s initial getBalance.
  mockGetBalanceImpl = async () => ({ balance: 0 });
  const result = await connect(WALLET_ID, VALID_NWC_URL);
  expect(result.success).toBe(true);
});

afterEach(() => {
  jest.useRealTimers();
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

    // With replyTimeoutMs set, attempts is 1 (no retry) — the ceiling is the timeout itself, ~200 ms in this test. Kept generously slack here for CI scheduling.
    const start = Date.now();
    const result = await getBalance(WALLET_ID, { replyTimeoutMs: 200 });
    const elapsed = Date.now() - start;

    expect(result).toBeNull();
    // 1 attempt × 200 ms timeout = ~200 ms. Allow generous slack for CI scheduling, but well under the SDK's 10 s default — that's the regression this guards against.
    expect(elapsed).toBeLessThan(2000);
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

    const balance = await getBalance(WALLET_ID);
    expect(balance).toBe(999);
    expect(calls).toBe(2);
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
