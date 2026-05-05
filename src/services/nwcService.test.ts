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
