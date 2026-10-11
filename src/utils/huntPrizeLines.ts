import { msatToSats } from '../services/lnurlWithdrawService';

type Translate = (scope: string, options?: Record<string, unknown>) => string;

/**
 * "N sats per claim" (or "min–max sats per claim") for a validated
 * LNURL-withdraw prize, formatted in the app locale. Returns null when the
 * prize is unknown: a 0/undefined maxWithdrawable means we don't know it,
 * not that it's zero, so never advertise "0 sats per claim" (#681 review).
 */
export function validatedSatsLine(
  minWithdrawableMsat: number,
  maxWithdrawableMsat: number,
  t: Translate,
  locale?: string,
): string | null {
  const min = msatToSats(minWithdrawableMsat);
  const max = msatToSats(maxWithdrawableMsat);
  if (max <= 0) return null;
  return min === max
    ? t('huntCreateScreen.satsPerClaim', { amount: max.toLocaleString(locale) })
    : t('huntCreateScreen.satsPerClaimRange', {
        min: min.toLocaleString(locale),
        max: max.toLocaleString(locale),
      });
}

/**
 * Prize hint for the cross-device edit card, from the editable amount field
 * (pre-filled from the published `amount`). Null unless it's a positive
 * whole number — we never surface "0 sats".
 */
export function crossDevicePrizeLine(
  amountText: string,
  t: Translate,
  locale?: string,
): string | null {
  const n = parseInt(amountText.trim(), 10);
  return Number.isFinite(n) && n > 0
    ? t('huntCreateScreen.prizeLine', { amount: n.toLocaleString(locale) })
    : null;
}
