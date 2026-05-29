// Shared fiat-symbol map + approximate fiat-label formatting for sats amounts.
// Used by the LNURL-withdraw sheet and the geo-cache prize screen (and anywhere
// else that shows "≈ $1.23" beside a sats figure) so the symbol table and
// formatting stay in one place. #341.

export const FIAT_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CNY: '¥',
  CAD: 'C$',
  AUD: 'A$',
  CHF: 'CHF ',
  ZAR: 'R',
};

/**
 * Format `sats` as an approximate fiat label (e.g. `≈ $1.23`) given the BTC
 * spot price and the user's currency. Returns null when there's nothing to
 * show (no price yet, or a non-positive amount), so callers can skip rendering.
 */
export function formatFiatApprox(
  sats: number,
  btcPrice: number | null | undefined,
  currency: string,
): string | null {
  if (!btcPrice || sats <= 0) return null;
  const value = (sats / 1e8) * btcPrice;
  const num = value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const symbol = FIAT_SYMBOLS[currency] ?? '';
  return symbol ? `≈ ${symbol}${num}` : `≈ ${num} ${currency}`;
}
