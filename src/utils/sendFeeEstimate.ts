/**
 * Outcome of a hot-wallet send dry-run. `insufficient` is kept apart from
 * `error` so Send can say "your balance is too low" instead of "fee
 * unavailable" (#1196) — BDK refuses to build a transaction it can't fund.
 */
export type SendFeeEstimate =
  | { kind: 'fee'; feeSats: number }
  | ({ kind: 'insufficient' } & DirectShortfall)
  | { kind: 'error' };

/** What BDK reported when it couldn't fund a send (`needed` = amount + fee). */
export interface DirectShortfall {
  neededSats: number | null;
  availableSats: number | null;
}

// BDK's Display text: "Insufficient funds: 1000 sat available of 5000 sat
// needed". Android passes it through as the rejection message; iOS wraps it as
// `InsufficientFunds(message: "…")`. `needed` is amount + miner fee.
const AMOUNTS = /(\d+)\s*sats?\s+available\s+of\s+(\d+)\s*sats?\s+needed/i;

/** Classify a dry-run failure: a BDK InsufficientFunds error, or anything else. */
export function classifySendFeeError(error: unknown): SendFeeEstimate {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (!/insufficient\s*funds/i.test(text)) return { kind: 'error' };
  const match = AMOUNTS.exec(text);
  const parse = (value: string | undefined) => {
    const n = value === undefined ? NaN : Number(value);
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
  };
  return {
    kind: 'insufficient',
    availableSats: parse(match?.[1]),
    neededSats: parse(match?.[2]),
  };
}
