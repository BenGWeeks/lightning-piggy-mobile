import { de, en, es, hi, hu, mr, pl, uk, zh } from 'make-plural/cardinals';
import type { I18n } from 'i18n-js';

/** CLDR plural category, as returned by make-plural. */
export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

type CardinalRule = (n: number | string) => PluralCategory;

/**
 * Per-locale CLDR cardinal rules. Out of the box i18n-js applies the
 * ENGLISH rule to every locale, which is wrong for most of ours: Ukrainian
 * and Polish need `few` (2-4) and `many` (5-20, 25-30…), Ukrainian 21 is
 * `one` ("21 відгук"), and Chinese has no singular form at all.
 *
 * Why a rule table rather than `Intl.PluralRules`: Hermes (our JS engine on
 * Android and iOS) implements only Collator / DateTimeFormat / NumberFormat
 * from Intl, so `Intl.PluralRules` is undefined on device. make-plural is
 * the CLDR data i18n-js itself already depends on (pure JS, a few hundred
 * bytes per locale), so it is the same source of truth on every engine;
 * plurals.test.ts cross-checks it against Node's real `Intl.PluralRules`.
 *
 * Keyed by the i18n catalogue codes (`zh-Hans`, not `zh`) so adding a
 * locale to SUPPORTED_LOCALES without a rule here is a type error.
 */
export const CARDINAL_RULES = {
  en,
  es,
  uk,
  de,
  'zh-Hans': zh,
  hu,
  pl,
  hi,
  mr,
} satisfies Record<string, CardinalRule>;

export type PluralLocale = keyof typeof CARDINAL_RULES;

/**
 * Ordered list of plural keys i18n-js should try for `count` in `locale`;
 * it uses the first one the catalogue entry defines.
 *
 * - `zero` first for a count of 0, as i18n-js does by default, so entries
 *   with a dedicated zero message (e.g. "Remove old devices") keep it.
 * - then the locale's CLDR category.
 * - then `other`, then `one`, as safety nets: a catalogue entry that lacks
 *   the category (e.g. a `few`/`many` form not yet translated) degrades to
 *   a real sentence instead of a "missing translation" string.
 */
export function pluralKeys(locale: PluralLocale, count: number): PluralCategory[] {
  const keys: PluralCategory[] = [];
  if (count === 0) keys.push('zero');
  const category = CARDINAL_RULES[locale](Math.abs(count));
  if (!keys.includes(category)) keys.push(category);
  for (const fallback of ['other', 'one'] as const) {
    if (!keys.includes(fallback)) keys.push(fallback);
  }
  return keys;
}

/** Register the CLDR rule for every catalogue locale on an I18n instance. */
export function registerPluralRules(instance: I18n): void {
  for (const locale of Object.keys(CARDINAL_RULES) as PluralLocale[]) {
    instance.pluralization.register(locale, (_i18n, count) => pluralKeys(locale, count));
  }
}
