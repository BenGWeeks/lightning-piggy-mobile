/**
 * Helpers for asking "which wallets can settle a given payment target?"
 *
 * Used by `SendSheet` to scope the wallet picker to only those wallets
 * whose underlying settlement path can actually pay the decoded invoice.
 * Without this, the picker would (and historically did) include wallets
 * that silently fail when the user taps Send — e.g. an on-chain wallet
 * surfaced for a BOLT11 invoice. See issue #144.
 *
 * The capability matrix mirrors `SendSheet.handleSend`'s settlement
 * branches (don't change one without the other):
 *
 *   - BOLT11 / Lightning-address / LNURL-pay
 *       → NWC wallets that are currently connected.
 *         (Hot on-chain wallets cannot pay a Lightning invoice today —
 *         submarine swaps are not wired up.)
 *
 *   - on-chain address (plain or BIP-21)
 *       → on-chain wallets directly, or any connected NWC wallet via
 *         a Boltz reverse swap (LN -> on-chain).
 */
import type { WalletState } from '../types/wallet';

/**
 * The kind of payment target the SendSheet has currently decoded.
 * Determined by the input parser, not by user choice.
 */
export type InvoiceType =
  /** BOLT11 invoice (lnbc/lntb/...) */
  | 'bolt11'
  /** LNURL-pay or LUD-16 lightning address (user@domain) */
  | 'lnurl-pay'
  /** Bare on-chain address or BIP-21 bitcoin: URI */
  | 'onchain';

/**
 * Can `wallet` settle a payment of type `invoiceType` right now?
 * "Right now" means the wallet is in a state where calling the matching
 * settlement API would not immediately fail — e.g. an NWC wallet that
 * is currently disconnected can't pay anything until it reconnects.
 */
export function canSettleInvoiceType(wallet: WalletState, invoiceType: InvoiceType): boolean {
  switch (invoiceType) {
    case 'bolt11':
    case 'lnurl-pay':
      // Lightning settlement only — must be a connected NWC wallet.
      return wallet.walletType === 'nwc' && wallet.isConnected;
    case 'onchain':
      // Direct on-chain (any on-chain wallet can broadcast / build a
      // PSBT — even xpub-only wallets surface the address-derivation +
      // PSBT-export flow), or Boltz reverse swap from a connected NWC.
      if (wallet.walletType === 'onchain') return true;
      return wallet.walletType === 'nwc' && wallet.isConnected;
  }
}

/**
 * Filter `wallets` down to those that can settle `invoiceType`.
 * Order is preserved so the caller can keep the user's wallet ordering.
 */
export function compatibleWalletsForInvoice(
  wallets: WalletState[],
  invoiceType: InvoiceType,
): WalletState[] {
  return wallets.filter((w) => canSettleInvoiceType(w, invoiceType));
}

/**
 * Pick the default wallet for the SendSheet given the user's `activeWalletId`
 * and the invoice type just decoded.
 *
 * Rule: prefer the active wallet if it's compatible (least surprise — the
 * wallet selected on the home carousel is the one most users expect to
 * pay from). Otherwise fall back to the first compatible wallet so the
 * user isn't staring at a Pay button that will silently fail. Returns
 * `null` only when no wallet can settle the invoice at all — the caller
 * should surface a "no compatible wallet" empty state in that case.
 */
export function defaultWalletForInvoice(
  wallets: WalletState[],
  activeWalletId: string | null,
  invoiceType: InvoiceType,
): WalletState | null {
  const compatible = compatibleWalletsForInvoice(wallets, invoiceType);
  if (compatible.length === 0) return null;
  const active = compatible.find((w) => w.id === activeWalletId);
  return active ?? compatible[0];
}
