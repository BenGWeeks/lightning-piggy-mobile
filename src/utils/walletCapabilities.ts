import type { WalletState } from '../types/wallet';

/**
 * True if this wallet can originate a payment — i.e. is a candidate
 * source for the Transfer flow.
 *
 * Mirrors the per-wallet `canSend` rule used in HomeScreen for the
 * active wallet's Send button: NWC wallets are always sendable
 * (intentionally NOT gated on the transient `isConnected` flag — see
 * the long comment by `canSend` in HomeScreen.tsx; gating here was
 * the root cause of #199 / #302 where Transfer stayed greyed out
 * while Send worked), on-chain wallets are sendable only when
 * imported from a mnemonic (xpub-only wallets are watch-only and
 * have no signing key).
 *
 * Keep this exhaustive when adding new `WalletType`s.
 */
export function isSendableWallet(w: WalletState): boolean {
  if (w.walletType === 'nwc') return true;
  if (w.walletType === 'onchain') return w.onchainImportMethod === 'mnemonic';
  return false;
}
