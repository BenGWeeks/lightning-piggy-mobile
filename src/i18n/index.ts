import { I18n } from 'i18n-js';
import type { Scope, TranslateOptions } from 'i18n-js';
import enJson from './locales/en.json';
import esJson from './locales/es.json';
import type { Translations } from './locales/types';

// #137 infra: seeded with en + es to prove the pipeline end-to-end (tab
// bar labels). fr/de/nl (named in the issue) land as their own follow-up
// batches, same as every other surface — see the issue's "extract in
// batches per surface" plan.
//
// Locale catalogues are plain JSON (not .ts) so a translation-only
// contribution — the issue explicitly calls this out as a good first
// contribution — never requires touching TypeScript. The `Translations`
// type-check below is what keeps them honest: assigning a JSON import to
// a `Translations`-typed const fails `tsc` if that file is missing (or
// misspells) a key, same guarantee a hand-written .ts file would give.
const en: Translations = enJson;
const es: Translations = esJson;

/** Raw catalogue dict — exported so LocaleContext can build its own
 *  per-locale I18n instance for rendering (see the render-purity note
 *  there) without duplicating the JSON imports. */
export const translations = { en, es };

export const SUPPORTED_LOCALES = ['en', 'es'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export function isSupportedLocale(code: string): code is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(code);
}

/** Shared config every I18n instance in the app uses — kept in one place
 *  so the module-level singleton below and LocaleContext's per-locale
 *  render instances can't drift apart. */
export function createI18nInstance(locale: SupportedLocale): I18n {
  const instance = new I18n(translations);
  instance.defaultLocale = 'en';
  instance.enableFallback = true;
  instance.locale = locale;
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
