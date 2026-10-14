// When may the Market drop a filter the shopper chose? Only when the seller
// scope (mode) changed, or when the choice has been missing from
// SELLER_ABSENT_LOADS consecutive completed loads — for a merchant, loads in
// which the relays that carried their listings actually answered. A load
// that simply didn't hear from a seller's relay never counts against them.
// Pure, so the rules are unit-testable away from the screen.
import type { MarketProduct } from '../data/marketProducts';
import { merchantId, merchantLabel, type MarketMerchant } from './marketMerchants';
import type { MarketMode } from './marketMode';

/** Consecutive answered loads a chosen merchant / currency may be missing from. */
export const SELLER_ABSENT_LOADS = 2;

interface TrackedChoice {
  id: string;
  /** Consecutive judged loads the choice was missing from. */
  misses: number;
}
export interface TrackedMerchant extends TrackedChoice {
  /** Last label seen for the merchant, so its chip can stay rendered. */
  label: string | null;
  /** Relays that served the merchant's listings when last seen. */
  relays: readonly string[];
}
export interface SelectionGuard {
  /** Identity of the last load judged (`mode:generation`). */
  load: string | null;
  /** Seller scope of the last load judged (or the scope on mount). */
  mode: MarketMode;
  merchant: TrackedMerchant | null;
  currency: TrackedChoice | null;
}

export interface SelectionInput {
  mode: MarketMode;
  /** The completed, settled load now on screen, or null while one is pending. */
  load: string | null;
  /** Relays that answered that load; undefined when unknown. */
  answeredRelays?: readonly string[];
  merchant: string | null;
  /** The selected merchant's option in the current catalogue, if present. */
  merchantOption?: MarketMerchant;
  /** Relays that served the selected merchant's current listings. */
  merchantRelays: readonly string[];
  currency: string | null;
  currencyPresent: boolean;
}

export interface SelectionVerdict {
  guard: SelectionGuard;
  clearMerchant: boolean;
  clearCurrency: boolean;
}

export function initialSelectionGuard(mode: MarketMode): SelectionGuard {
  return { load: null, mode, merchant: null, currency: null };
}

/** Relays that served any of a merchant's listings in the current catalogue. */
export function merchantRelays(products: readonly MarketProduct[], id: string): string[] {
  const relays = new Set<string>();
  for (const product of products)
    if (merchantId(product) === id) product.listing?.seenOn?.forEach((r) => relays.add(r));
  return [...relays].sort();
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, i) => value === b[i]);

/** Follow the current selection, refreshing what we know while it's on screen. */
function track(previous: TrackedMerchant | null, input: SelectionInput): TrackedMerchant | null {
  const { merchant, merchantOption, merchantRelays: relays } = input;
  if (merchant === null) return null;
  if (previous?.id !== merchant)
    return { id: merchant, misses: 0, label: merchantOption?.label ?? null, relays };
  if (!merchantOption) return previous;
  const nextRelays = relays.length > 0 ? relays : previous.relays;
  if (previous.label === merchantOption.label && sameList(previous.relays, nextRelays))
    return previous;
  return { ...previous, label: merchantOption.label, relays: nextRelays };
}

/** Judge one choice against a load; returns the next tracking state or null to clear. */
function judge<T extends TrackedChoice>(
  choice: T,
  present: boolean,
  scopeChanged: boolean,
  counts: boolean,
): T | null {
  if (present) return choice.misses === 0 ? choice : { ...choice, misses: 0 };
  if (scopeChanged) return null;
  if (!counts) return choice;
  const misses = choice.misses + 1;
  return misses >= SELLER_ABSENT_LOADS ? null : { ...choice, misses };
}

export function reconcileSelection(guard: SelectionGuard, input: SelectionInput): SelectionVerdict {
  let merchant = track(guard.merchant, input);
  let currency: TrackedChoice | null =
    input.currency === null
      ? null
      : guard.currency?.id === input.currency
        ? guard.currency
        : { id: input.currency, misses: 0 };
  let clearMerchant = false;
  let clearCurrency = false;
  const judged = input.load !== null && input.load !== guard.load;
  if (judged) {
    const scopeChanged = input.mode !== guard.mode;
    if (merchant) {
      // Unknown relays (never seen, or no outcome reported) can't excuse an
      // absence, so it counts; otherwise only an answer from one of them does.
      const answered = input.answeredRelays;
      const relaysAnswered =
        answered === undefined ||
        merchant.relays.length === 0 ||
        merchant.relays.some((relay) => answered.includes(relay));
      const next = judge(merchant, !!input.merchantOption, scopeChanged, relaysAnswered);
      clearMerchant = next === null;
      merchant = next;
    }
    if (currency) {
      const next = judge(currency, input.currencyPresent, scopeChanged, true);
      clearCurrency = next === null;
      currency = next;
    }
  }
  const unchanged = !judged && merchant === guard.merchant && currency === guard.currency;
  return {
    guard: unchanged
      ? guard
      : {
          load: judged ? input.load : guard.load,
          mode: judged ? input.mode : guard.mode,
          merchant,
          currency,
        },
    clearMerchant,
    clearCurrency,
  };
}

/**
 * Keep a chosen merchant's chip rendered (and selected, so it can be cleared)
 * while it has no listings in the current catalogue.
 */
export function withSelectedMerchant(
  options: MarketMerchant[],
  selected: string | null,
  label: string | null,
): MarketMerchant[] {
  if (selected === null || options.some((option) => option.id === selected)) return options;
  const fallback = /^[a-f0-9]{64}$/.test(selected) ? merchantLabel(selected) : selected;
  return [...options, { id: selected, label: label ?? fallback, count: 0, curated: false }];
}

/** Same for a chosen currency. */
export function withSelectedCurrency(currencies: string[], selected: string | null): string[] {
  return selected === null || currencies.includes(selected)
    ? currencies
    : [...currencies, selected];
}
