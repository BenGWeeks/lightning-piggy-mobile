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

    // withRetry() does 2 attempts with 1500 ms sleep between them, so
    // the upper bound for the whole call is roughly:
    //   2 * replyTimeoutMs + 1 * 1500ms = 5500 ms for a 2 s timeout.
    // Real-time wait is fine here — kept short so the test stays fast.
    const start = Date.now();
    const result = await getBalance(WALLET_ID, { replyTimeoutMs: 200 });
    const elapsed = Date.now() - start;

    expect(result).toBeNull();
    // 2 attempts × 200 ms timeout + 1 × 1500 ms backoff ≈ 1900 ms.
    // Allow generous slack for CI scheduling, but well under the SDK's
    // 10 s default — that's the regression this guards against.
    expect(elapsed).toBeLessThan(4000);
  });

  it('retries on transient failure and returns the eventual balance', async () => {
    let calls = 0;
    mockGetBalanceImpl = async () => {
      calls++;
      if (calls === 1) throw new Error('reply timeout: event abc');
      return { balance: 999 };
    };

    const balance = await getBalance(WALLET_ID, { replyTimeoutMs: 2500 });
    expect(balance).toBe(999);
    expect(calls).toBe(2);
  });

  it('falls back to the SDK default timeout when no option is given', async () => {
    // Without `replyTimeoutMs`, the call must reach the SDK directly —
    // no withTimeout wrapper. Easiest pin: a fast resolve still works
    // and the value is returned unchanged.
    mockGetBalanceImpl = async () => ({ balance: 7 });
    const balance = await getBalance(WALLET_ID);
    expect(balance).toBe(7);
  });
});
