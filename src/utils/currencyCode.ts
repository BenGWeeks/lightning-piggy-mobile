// Canonical currency codes for Market listings. Sellers (and other Nostr
// market clients) spell the sats unit several ways — `SAT`, `SATS`, `sat`,
// `Sats` — and occasionally lower-case fiat codes (`eur`). Anything that
// groups or compares currencies (filter chips, the currency predicate,
// shipping-cost combining, seller events) goes through this one helper so the
// spellings collapse to a single canonical code. Pure — no React, no I/O.

/** Canonical code for satoshi-denominated prices. */
export const SATS_CURRENCY_CODE = 'SATS';

/**
 * Trim + upper-case a currency code, folding the `SAT` spelling into the
 * canonical `SATS` (`sat`, `Sats`, ` SATS ` → `SATS`; `eur` → `EUR`).
 *
 * Millisatoshi units (`MSAT` / `MSATS`) are deliberately NOT folded into
 * `SATS`: the listing parser doesn't convert their amounts, so merging them
 * would put a 1000× mis-scaled price under the sats chip.
 */
export function normalizeCurrencyCode(currency: string): string {
  const upper = currency.trim().toUpperCase();
  return upper === 'SAT' ? SATS_CURRENCY_CODE : upper;
}

/** Whether two currency codes name the same currency once normalised. */
export function sameCurrencyCode(a: string, b: string): boolean {
  return normalizeCurrencyCode(a) === normalizeCurrencyCode(b);
}
