import { I18n } from 'i18n-js';
import type { Scope, TranslateOptions } from 'i18n-js';
import enJson from './locales/en.json';
import deJson from './locales/de.json';
import esJson from './locales/es.json';
import huJson from './locales/hu.json';
import plJson from './locales/pl.json';
import ukJson from './locales/uk.json';
import type { Translations } from './locales/types';
import { registerPluralRules } from './plurals';

// #137 infra; languages added in batches since (#1312). Adding one: drop
// `locales/<code>.json` next to en.json, import + register it below, add a
// CLDR rule in plurals.ts and a native-name label in DisplayLanguageScreen.
// catalogues.test.ts then guards key parity, placeholders and plural forms.
//
// Locale catalogues are plain JSON (not .ts) so a translation-only
// contribution — the issue explicitly calls this out as a good first
// contribution — never requires touching TypeScript. The `Translations`
// type-check below is what keeps them honest: assigning a JSON import to
// a `Translations`-typed const fails `tsc` if that file is missing (or
// misspells) a key, same guarantee a hand-written .ts file would give.
const en: Translations = enJson;
const de: Translations = deJson;
const es: Translations = esJson;
const hu: Translations = huJson;
const pl: Translations = plJson;
const uk: Translations = ukJson;

/** Raw catalogue dict — exported so LocaleContext can build its own
 *  per-locale I18n instance for rendering (see the render-purity note
 *  there) without duplicating the JSON imports. */
export const translations = { en, de, es, hu, pl, uk };

export const SUPPORTED_LOCALES = ['en', 'de', 'es', 'hu', 'pl', 'uk'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export function isSupportedLocale(code: string): code is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(code);
}

/**
 * Map a device locale (a BCP-47 tag such as `es-MX`, `zh-Hans-CN`, `zh_TW`, or
 * a bare language code such as `uk`) to the catalogue that serves it, or
 * `null` when there is none. Chinese is the one language whose catalogue key
 * carries a script: every `zh*` tag maps to `zh-Hans` (Simplified), including
 * Traditional (`zh-Hant`, `zh-TW`, `zh-HK`) until a Traditional catalogue
 * exists, since Simplified is far more readable to them than English.
 */
export function supportedLocaleForDevice(tag: string | null | undefined): SupportedLocale | null {
  if (!tag) return null;
  const language = tag.split(/[-_]/)[0].toLowerCase();
  const candidate = language === 'zh' ? 'zh-Hans' : language;
  return isSupportedLocale(candidate) ? candidate : null;
}

/**
 * BCP-47 tag to hand to `Intl` / `toLocale*String` when formatting numbers and
 * dates for a catalogue locale. Identical to the catalogue code except where
 * the CLDR default numbering system isn't what our users see in payment apps:
 * Marathi defaults to Devanagari digits (१,२३४), but Indian wallets show
 * Western digits, so pin `latn` (Hindi already defaults to it; pinned too so
 * both stay in step). Indian digit grouping (1,23,456) is kept, as expected.
 */
const INTL_TAG_OVERRIDES: Partial<Record<string, string>> = {
  hi: 'hi-u-nu-latn',
  mr: 'mr-u-nu-latn',
};

export function intlLocaleFor(locale: SupportedLocale): string {
  return INTL_TAG_OVERRIDES[locale] ?? locale;
}

/** Shared config every I18n instance in the app uses — kept in one place
 *  so the module-level singleton below and LocaleContext's per-locale
 *  render instances can't drift apart. */
export function createI18nInstance(locale: SupportedLocale): I18n {
  const instance = new I18n(translations);
  instance.defaultLocale = 'en';
  instance.enableFallback = true;
  instance.locale = locale;
  // CLDR plural rules per locale (i18n-js defaults to English rules for all).
  registerPluralRules(instance);
  return instance;
}

// Module-level singleton for non-React call sites only (service/util code
// that can't use `useTranslation()`). `LocaleContext` keeps its `.locale`
// in sync via a `useEffect` — after commit, never during render — so nothing
// in the render phase ever depends on this object's mutable state. See the
// comment on `t()` below and the render-purity note in LocaleContext.tsx.
const i18n = createI18nInstance('en');

export default i18n;

/**
 * Plain (non-hook) translate — for service/util call sites that aren't
 * React components and can't use `useTranslation()`. Always reads
 * whichever locale `LocaleContext` last set on the shared `i18n`
 * instance (synced post-commit, so it can lag the UI by a tick — fine
 * for imperative/async call sites, which is all this is for). Not wired
 * to anything yet (GIPHY's `lang` param is a follow-up per #137), but
 * the surface is ready when that lands.
 */
export function t(scope: Scope, options?: TranslateOptions): string {
  return i18n.t(scope, options);
}
