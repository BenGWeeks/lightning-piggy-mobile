/**
 * Wire-up guards for the on-chain incoming-payment celebration (#134).
 *
 * The full celebration flow lives behind the `WalletProvider` React
 * context — too many native module dependencies (AsyncStorage, BDK,
 * NWC, Reanimated) to render in a unit test without a heroic mock
 * web. Instead we pin the small pure helper that classifies a
 * detected balance increment by its rail; the rest of the path
 * (balance-diff detector → setLastIncomingPayment → overlay) is
 * straight-line state plumbing exercised by the Maestro flows.
 *
 * Importing from the standalone module rather than re-exporting via
 * WalletContext so the test doesn't pay the full provider's import
 * cost (BDK, bitcoinjs-lib, SecureStore, …).
 */
import { incomingPaymentSourceFor } from './incomingPaymentSource';

describe('incomingPaymentSourceFor (#134)', () => {
  it("classifies an 'onchain' wallet as the on-chain rail", () => {
    expect(incomingPaymentSourceFor('onchain')).toBe('onchain');
  });

  it("classifies an 'nwc' wallet as the lightning rail", () => {
    // NWC is a transport for Lightning custodial / self-custodial
    // wallets — celebration UI should match the Lightning path
    // (no mempool hint, instant-settled framing).
    expect(incomingPaymentSourceFor('nwc')).toBe('lightning');
  });

  it('defaults non-onchain wallet types to the lightning rail', () => {
    // Defensive: if a new walletType ever lands without an explicit
    // mapping, fall back to the Lightning UX. Better to miss the
    // mempool hint than to wrongly tell a Lightning user their
    // payment needs a confirmation. Cast through `as never` so the
    // runtime fallback gets exercised even though the type union
    // currently disallows the literal.
    expect(incomingPaymentSourceFor('future-rail' as never)).toBe('lightning');
  });
});
