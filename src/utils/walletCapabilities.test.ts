/**
 * Regression tests for #199 / #302 — Transfer button stayed greyed
 * out even with multiple wallets where at least one could send.
 *
 * Root cause: `hasSendableWallet` in HomeScreen required
 * `w.isConnected` for NWC wallets, but per the long comment by
 * `canSend` we explicitly do NOT gate Send on the transient
 * `isConnected` flag (it can flip false during the post-PR-D
 * enable() window or after a brief WebSocket blip).
 *
 * `isSendableWallet` is the single source of truth for "is this
 * wallet a candidate source for Transfer?" — it MUST mirror the
 * per-wallet rule that drives the Send button.
 */

import { isSendableWallet } from './walletCapabilities';
import type { WalletState } from '../types/wallet';

function makeWallet(overrides: Partial<WalletState>): WalletState {
  return {
    id: 'w1',
    alias: 'Test',
    theme: 'lightning-piggy',
    order: 0,
    walletType: 'nwc',
    lightningAddress: null,
    isConnected: true,
    balance: 1000,
    walletAlias: null,
    transactions: [],
    ...overrides,
  };
}

describe('isSendableWallet', () => {
  it('returns true for an NWC wallet that is currently connected', () => {
    expect(isSendableWallet(makeWallet({ walletType: 'nwc', isConnected: true }))).toBe(true);
  });

  // Regression for #199 / #302: the bug was the OLD predicate gating
  // NWC sendability on `isConnected`. NWC wallets must count as
  // sendable for Transfer regardless of the transient connection
  // flag — same rule as the Send button's `canSend`.
  it('returns true for an NWC wallet even when isConnected is false', () => {
    expect(isSendableWallet(makeWallet({ walletType: 'nwc', isConnected: false }))).toBe(true);
  });

  it('returns true for an on-chain wallet imported from mnemonic', () => {
    expect(
      isSendableWallet(makeWallet({ walletType: 'onchain', onchainImportMethod: 'mnemonic' })),
    ).toBe(true);
  });

  it('returns false for a watch-only on-chain wallet (xpub import)', () => {
    expect(
      isSendableWallet(makeWallet({ walletType: 'onchain', onchainImportMethod: 'xpub' })),
    ).toBe(false);
  });

  it('returns false for an on-chain wallet with no import method recorded', () => {
    expect(
      isSendableWallet(makeWallet({ walletType: 'onchain', onchainImportMethod: undefined })),
    ).toBe(false);
  });
});

describe('Transfer button gating (HomeScreen `canTransfer` semantics)', () => {
  // Reproduces the in-app `canTransfer` calculation so we lock the
  // contract HomeScreen relies on. If this test ever fails, the
  // helper drifted from the rule and #199 will likely re-emerge.
  function canTransfer(wallets: WalletState[]): boolean {
    return wallets.some(isSendableWallet) && wallets.length >= 2;
  }

  it('enables Transfer with two NWC wallets, neither yet flipped to isConnected (the #199 / #302 scenario)', () => {
    const wallets = [
      makeWallet({ id: 'w1', walletType: 'nwc', isConnected: false }),
      makeWallet({ id: 'w2', walletType: 'nwc', isConnected: false }),
    ];
    expect(canTransfer(wallets)).toBe(true);
  });

  it('enables Transfer with a mix of NWC + watch-only on-chain (>= 2 wallets, at least one sendable)', () => {
    const wallets = [
      makeWallet({ id: 'w1', walletType: 'nwc', isConnected: true }),
      makeWallet({ id: 'w2', walletType: 'onchain', onchainImportMethod: 'xpub' }),
    ];
    expect(canTransfer(wallets)).toBe(true);
  });

  it('disables Transfer when only one wallet is configured, regardless of sendability', () => {
    const wallets = [makeWallet({ id: 'w1', walletType: 'nwc', isConnected: true })];
    expect(canTransfer(wallets)).toBe(false);
  });

  it('disables Transfer when there are 2+ wallets but none can send (all watch-only)', () => {
    const wallets = [
      makeWallet({ id: 'w1', walletType: 'onchain', onchainImportMethod: 'xpub' }),
      makeWallet({ id: 'w2', walletType: 'onchain', onchainImportMethod: 'xpub' }),
    ];
    expect(canTransfer(wallets)).toBe(false);
  });

  it('disables Transfer when the wallet list is empty', () => {
    expect(canTransfer([])).toBe(false);
  });
});
