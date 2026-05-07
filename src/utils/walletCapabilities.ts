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
 * Switch with `assertNever` so adding a new `WalletType` (or new `OnchainImportMethod`) becomes a compile error here, not a silent runtime `false`.
 */
export function isSendableWallet(w: WalletState): boolean {
  switch (w.walletType) {
    case 'nwc':
      return true;
    case 'onchain':
      return isSendableOnchainImportMethod(w.onchainImportMethod);
    default: {
      // assertNever — adding a new WalletType becomes a compile error here, not a silent runtime `false`.
      const _exhaustive: never = w.walletType;
      return _exhaustive;
    }
  }
}

// 'mnemonic' has signing keys today. 'generated' is reserved in the type for future hot-wallet support but no codepath creates one yet, so treat it as not-sendable until the create/back-up/sign path lands. 'xpub' is watch-only.
function isSendableOnchainImportMethod(method: WalletState['onchainImportMethod']): boolean {
  switch (method) {
    case 'mnemonic':
      return true;
    case 'generated':
    case 'xpub':
    case undefined:
      return false;
    default: {
      const _exhaustive: never = method;
      return _exhaustive;
    }
  }
}
