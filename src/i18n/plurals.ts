import { de, en, es, hi, hu, mr, pl, uk, zh } from 'make-plural/cardinals';
import type { I18n } from 'i18n-js';

/** CLDR plural category, as returned by make-plural. */
export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

/** Plural key i18n-js may look up: a CLDR category, or the explicit
 *  exactly-one form (`=1`, as in ICU MessageFormat) — see pinCountlessSingulars. */
export type PluralKey = PluralCategory | '=1';

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

const CLDR_ORDER: PluralCategory[] = ['zero', 'one', 'two', 'few', 'many', 'other'];

export function isPluralLocale(locale: string): locale is PluralLocale {
  return Object.prototype.hasOwnProperty.call(CARDINAL_RULES, locale);
}

/**
 * The plural forms a catalogue for `locale` must define: every CLDR category
 * a whole-number count (0–200) can select, plus `other` (always the final
 * fallback), in CLDR order. e.g. uk/pl → one, few, many, other; de/hu/hi/mr →
 * one, other; zh-Hans → other. Edge categories real counts never hit (Spanish
 * `many` for exact millions) are left to the `other` fallback.
 *
 * Single source of truth shared by the runtime tests (catalogues.test.ts) and
 * the catalogue sync tooling, so the two can never disagree. Throws for a
 * locale without a rule, so a new language can't silently skip plurals.
 */
export function requiredPluralCategories(locale: string): PluralCategory[] {
  if (!isPluralLocale(locale)) {
    throw new Error(`No CLDR plural rule for "${locale}" — add it to CARDINAL_RULES`);
  }
  const rule = CARDINAL_RULES[locale];
  const needed = new Set<PluralCategory>(['other']);
  for (let n = 0; n <= 200; n++) needed.add(rule(n));
  return CLDR_ORDER.filter((c) => needed.has(c));
}

/**
 * Ordered list of plural keys i18n-js should try for `count` in `locale`;
 * it uses the first one the catalogue entry defines.
 *
 * - `zero` first for a count of 0, as i18n-js does by default, so entries
 *   with a dedicated zero message (e.g. "Remove old devices") keep it.
 * - `=1` for a count of exactly 1 (only present after pinCountlessSingulars).
 * - then the locale's CLDR category.
 * - then `other`, then `one`, as safety nets: a catalogue entry that lacks
 *   the category (e.g. a `few`/`many` form not yet translated) degrades to
 *   a real sentence instead of a "missing translation" string.
 */
export function pluralKeys(locale: PluralLocale, count: number): PluralKey[] {
  const keys: PluralKey[] = [];
  if (count === 0) keys.push('zero');
  if (count === 1) keys.push('=1');
  const category = CARDINAL_RULES[locale](Math.abs(count));
  if (!keys.includes(category)) keys.push(category);
  for (const fallback of ['other', 'one'] as const) {
    if (!keys.includes(fallback)) keys.push(fallback);
  }
  return keys;
}

const COUNT_PLACEHOLDER = /\{\{\s*count\s*\}\}|%\{\s*count\s*\}/;
const CLDR_KEYS = ['zero', 'one', 'two', 'few', 'many', 'other'];

/** True when CLDR `one` in `locale` covers some whole number other than 1
 *  (Ukrainian 21, 31…; Hindi 0). */
function oneCoversOtherNumbers(locale: PluralLocale): boolean {
  const rule = CARDINAL_RULES[locale];
  for (let n = 0; n <= 200; n++) if (n !== 1 && rule(n) === 'one') return true;
  return false;
}

type CatalogueNode = { [key: string]: string | CatalogueNode };

/**
 * English `one` forms are often singular-only sentences that never show the
 * number ("…with the other person in {{group}}?"), and translations mirror
 * them. That's fine where CLDR `one` means exactly 1, but Ukrainian `one`
 * also covers 21, 31… — so a 21-member group would read "the other person".
 * For such locales, a `one` form without a `{{count}}` / `%{count}`
 * placeholder is moved to the explicit `=1` key: 1 still gets it, and 21
 * falls through to `other`. `one` forms that DO show the count ("21 відгук")
 * are left alone. Returns a new tree; the JSON imports are not mutated.
 */
export function pinCountlessSingulars<T extends object>(locale: PluralLocale, catalogue: T): T {
  if (!oneCoversOtherNumbers(locale)) return catalogue;
  const walk = (node: CatalogueNode): CatalogueNode => {
    const keys = Object.keys(node);
    const isPlural = keys.length > 0 && keys.every((k) => CLDR_KEYS.includes(k));
    if (isPlural) {
      const one = node.one;
      if (typeof one !== 'string' || COUNT_PLACEHOLDER.test(one)) return node;
      const rest = { ...node };
      delete rest.one;
      return { ...rest, '=1': one };
    }
    const out: CatalogueNode = {};
    for (const k of keys) {
      const v = node[k];
      out[k] = typeof v === 'string' ? v : walk(v);
    }
    return out;
  };
  return walk(catalogue as unknown as CatalogueNode) as unknown as T;
}

/** Register the CLDR rule for every catalogue locale on an I18n instance. */
export function registerPluralRules(instance: I18n): void {
  for (const locale of Object.keys(CARDINAL_RULES) as PluralLocale[]) {
    instance.pluralization.register(locale, (_i18n, count) => pluralKeys(locale, count));
  }
}
