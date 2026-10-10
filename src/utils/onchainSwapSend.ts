// Send-sheet rules for paying an on-chain address from a Lightning wallet via
// a Boltz reverse swap, where the typed / BIP21 amount is exactly what the
// recipient gets and fees go on top (#1175). Pure — no I/O, no React.
import type { SwapFees } from '../services/boltzService';
import { quoteExactRecipient, reverseRecipientRange } from './reverseSwapAmounts';

/** An i18n key + params explaining why the send can't go ahead. */
export interface SwapSendBlocker {
  key:
    | 'sendSheet.enterAmount'
    | 'sendSheet.minAmount'
    | 'sendSheet.maxAmount'
    | 'sendSheet.swapInsufficientBalance';
  params?: Record<string, string>;
}

const n = (v: number) => v.toLocaleString();

/**
 * Validate a swap send against Boltz's limits (translated to the recipient
 * side) and the wallet balance, which must cover the TOTAL paid — not just
 * the recipient amount. `balanceSats` null means unknown: let the wallet decide.
 */
export function reverseSwapSendBlocker(
  recipientSats: number,
  fees: SwapFees,
  balanceSats: number | null,
): SwapSendBlocker | null {
  if (!Number.isSafeInteger(recipientSats) || recipientSats <= 0)
    return { key: 'sendSheet.enterAmount' };
  const range = reverseRecipientRange(fees);
  if (!range || recipientSats < range.minSats)
    return { key: 'sendSheet.minAmount', params: { min: n(range?.minSats ?? fees.minAmount) } };
  if (recipientSats > range.maxSats)
    return { key: 'sendSheet.maxAmount', params: { max: n(range.maxSats) } };
  const quote = quoteExactRecipient(recipientSats, fees);
  if (balanceSats !== null && quote.invoiceSats > balanceSats)
    return {
      key: 'sendSheet.swapInsufficientBalance',
      params: {
        total: n(quote.invoiceSats),
        amount: n(recipientSats),
        fee: n(quote.feeSats),
        balance: n(balanceSats),
      },
    };
  return null;
}

/**
 * Lightning routing fees come on top of the swap invoice and many wallets
 * reserve for them before paying, so "send max" leaves this much of the
 * balance unspent: 1%, at least 10 sats.
 */
export function routingFeeReserve(balanceSats: number): number {
  return Math.max(10, Math.ceil(balanceSats * 0.01));
}

/**
 * Amount-entry bounds for a swap send: Boltz's limits on the recipient side,
 * capped so the total plus a routing-fee reserve fits the balance ("send
 * max"). When even the minimum doesn't fit, keep the server range — Send then
 * explains the shortfall.
 */
export function reverseSwapAmountBounds(
  fees: SwapFees,
  balanceSats: number | null,
): { minSats: number; maxSats: number } | null {
  const budget = balanceSats === null ? null : balanceSats - routingFeeReserve(balanceSats);
  return reverseRecipientRange(fees, budget) ?? reverseRecipientRange(fees);
}

/** `bc1qsc…0cc7dm` — enough of an on-chain address to recognise it in copy. */
export function shortOnchainAddress(address: string): string {
  return address.length > 16 ? `${address.slice(0, 6)}…${address.slice(-6)}` : address;
}
