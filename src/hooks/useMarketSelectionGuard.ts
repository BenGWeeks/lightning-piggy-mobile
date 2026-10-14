import { useEffect, useMemo, useState } from 'react';
import type { MarketProduct } from '../data/marketProducts';
import type { MarketPreferences } from '../services/marketStorage';
import { normalizeCurrencyCode } from '../utils/currencyCode';
import type { MarketMerchant } from '../utils/marketMerchants';
import type { MarketMode } from '../utils/marketMode';
import {
  initialSelectionGuard,
  merchantRelays,
  reconcileSelection,
  withSelectedCurrency,
  withSelectedMerchant,
} from '../utils/marketSelectionGuard';
import { normalizeShipsToSelection } from '../utils/marketShipsTo';

interface LiveLoad {
  completed: boolean;
  loading: boolean;
  incomplete: boolean;
  profilesReady?: boolean;
  generation?: number;
  answeredRelays?: readonly string[];
}

interface Options {
  ready: boolean;
  mode: MarketMode;
  live: LiveLoad;
  /** The mode-scoped catalogue the options derive from. */
  products: readonly MarketProduct[];
  preferences: MarketPreferences;
  /** The saved merchant resolved to a current key (legacy labels upgraded). */
  merchant: string | null;
  merchantOptions: MarketMerchant[];
  currencies: string[];
  update: (patch: Partial<MarketPreferences>) => void;
}

/**
 * Keeps the shopper's merchant / currency choices across transient loads
 * (see `utils/marketSelectionGuard`) and the chips for them on screen, even
 * while the chosen merchant has nothing in the current catalogue.
 */
export function useMarketSelectionGuard({
  ready,
  mode,
  live,
  products,
  preferences,
  merchant,
  merchantOptions,
  currencies,
  update,
}: Options) {
  const [guard, setGuard] = useState(() => initialSelectionGuard(mode));
  const { merchant: savedMerchant, shipsTo, currency } = preferences;
  const merchantOption = merchant ? merchantOptions.find((m) => m.id === merchant) : undefined;
  const relays = useMemo(
    () => (merchant ? merchantRelays(products, merchant) : []),
    [products, merchant],
  );
  const canonicalCurrency = currency ? normalizeCurrencyCode(currency) : null;
  const currencyPresent = canonicalCurrency !== null && currencies.includes(canonicalCurrency);
  // Judge only a settled, complete load for the current scope.
  const load =
    ready && live.completed && !live.loading && !live.incomplete && live.profilesReady !== false
      ? `${mode}:${live.generation ?? 0}`
      : null;

  useEffect(() => {
    if (!ready) return;
    const verdict = reconcileSelection(guard, {
      mode,
      load,
      answeredRelays: live.answeredRelays,
      merchant,
      merchantOption,
      merchantRelays: relays,
      currency: canonicalCurrency,
      currencyPresent,
    });
    if (verdict.guard !== guard) setGuard(verdict.guard);
    const patch: Partial<MarketPreferences> = {};
    if (verdict.clearMerchant) patch.merchant = null;
    // Upgrade a legacy label selection to the merchant's stable key.
    else if (merchantOption && merchant !== savedMerchant) patch.merchant = merchant;
    // A selection saved before currencies were normalised ("SAT") maps onto
    // its canonical chip ("SATS") rather than being dropped.
    if (verdict.clearCurrency) patch.currency = null;
    else if (canonicalCurrency !== currency) patch.currency = canonicalCurrency;
    const normalizedShipsTo = normalizeShipsToSelection(shipsTo);
    if (normalizedShipsTo !== shipsTo) patch.shipsTo = normalizedShipsTo;
    if (Object.keys(patch).length > 0) update(patch);
  }, [
    ready,
    guard,
    mode,
    load,
    live.answeredRelays,
    merchant,
    merchantOption,
    relays,
    savedMerchant,
    currency,
    canonicalCurrency,
    currencyPresent,
    shipsTo,
    update,
  ]);

  const tracked = guard.merchant?.id === merchant ? guard.merchant : null;
  return {
    merchantOptions: useMemo(
      () => withSelectedMerchant(merchantOptions, merchant, tracked?.label ?? null),
      [merchantOptions, merchant, tracked?.label],
    ),
    currencies: useMemo(
      () => withSelectedCurrency(currencies, canonicalCurrency),
      [currencies, canonicalCurrency],
    ),
    /** The chosen merchant has no listings in the current catalogue. */
    merchantMissing: merchant !== null && !merchantOption,
    merchantName: merchantOption?.label ?? tracked?.label ?? null,
  };
}
