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

import { connect, getBalance } from './nwcService';

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

/**
 * `listTransactions` retry-exhaustion contract (#200).
 *
 * The cold-start hydration path in WalletContext seeds each wallet's
 * `transactions` from AsyncStorage, then kicks off a live refresh. If
 * that live refresh silently overwrote the hydrated cache with `[]`
 * after a flaky-relay retry exhaustion, the user saw "No transactions
 * yet" until the next successful poll.
 *
 * Contract pinned here:
 *   - All retries throw  → returns `null` (caller preserves cache).
 *   - Provider answers   → returns the array (possibly empty), which
 *                          is positive confirmation the wallet has no
 *                          history.
 *
 * Empty `[]` and `null` MUST stay distinguishable so the WalletContext
 * caller can decide whether to overwrite its cached + persisted list.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

// Names MUST be prefixed `mock*` — Jest's hoisted `jest.mock` factory
// is only allowed to reference outer-scope variables matching that
// prefix (guards against TDZ from the hoist).
const mockEnable = jest.fn();
const mockListTransactions = jest.fn();
const mockGetBalance = jest.fn();
const mockClose = jest.fn();

jest.mock('@getalby/sdk', () => {
  return {
    NostrWebLNProvider: jest.fn().mockImplementation(() => ({
      enable: mockEnable,
      listTransactions: mockListTransactions,
      getBalance: mockGetBalance,
      close: mockClose,
      // `client.connected` is read by ensureConnected to decide whether
      // to reconnect; `true` keeps the provider as-is for the test.
      client: { connected: true, pool: null },
    })),
  };
});

// A valid NWC URL — pubkey is 64 hex chars, has relay + secret.
const NWC_URL = `nostr+walletconnect://${'a'.repeat(64)}?relay=wss://relay.example.com&secret=${'b'.repeat(64)}`;
const WALLET_ID = 'wallet-200';

describe('nwcService.listTransactions (#200 retry-exhaustion contract)', () => {
  let nwcService: typeof import('./nwcService');

  beforeEach(async () => {
    jest.resetModules();
    mockEnable.mockReset().mockResolvedValue(undefined);
    mockListTransactions.mockReset();
    mockGetBalance.mockReset().mockResolvedValue({ balance: 0 });
    mockClose.mockReset();

    // Sync require, not dynamic import — Jest's VM doesn't enable
    // ECMAScript module loading by default, and the project's
    // existing tests use this pattern.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    nwcService = require('./nwcService');
    // Seed the per-module providers map so ensureConnected doesn't bail
    // with `null` before listTransactions ever runs.
    await nwcService.connect(WALLET_ID, NWC_URL);
  });

  it('returns null when every retry attempt throws (preserves caller cache)', async () => {
    mockListTransactions.mockRejectedValue(new Error('relay timeout'));

    const result = await nwcService.listTransactions(WALLET_ID);

    expect(result).toBeNull();
    // 3 attempts per the retry contract.
    expect(mockListTransactions).toHaveBeenCalledTimes(3);
  });

  it('returns the empty array when the backend positively answers with no transactions', async () => {
    mockListTransactions.mockResolvedValue({ transactions: [] });

    const result = await nwcService.listTransactions(WALLET_ID);

    expect(result).toEqual([]);
    expect(result).not.toBeNull();
  });

  it('returns the array when the backend answers with transactions', async () => {
    const txs = [{ type: 'incoming', amount: 1000 }];
    mockListTransactions.mockResolvedValue({ transactions: txs });

    const result = await nwcService.listTransactions(WALLET_ID);

    expect(result).toEqual(txs);
  });

  it('returns null when no provider is connected for the wallet', async () => {
    const result = await nwcService.listTransactions('unknown-wallet');

    expect(result).toBeNull();
    expect(mockListTransactions).not.toHaveBeenCalled();
  });
});
