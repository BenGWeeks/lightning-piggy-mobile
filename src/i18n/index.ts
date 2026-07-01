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

export const SUPPORTED_LOCALES = ['en', 'es'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export function isSupportedLocale(code: string): code is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(code);
}

const i18n = new I18n({ en, es });
i18n.defaultLocale = 'en';
i18n.enableFallback = true;
i18n.locale = 'en';

export default i18n;

/**
 * Plain (non-hook) translate — for service/util call sites that aren't
 * React components and can't use `useTranslation()`. Always reads
 * whichever locale `LocaleContext` last set on the shared `i18n`
 * instance, so it stays in sync with the in-app override without extra
 * plumbing. Not wired to anything yet (GIPHY's `lang` param is a
 * follow-up per #137), but the surface is ready when that lands.
 */
export function t(scope: Scope, options?: TranslateOptions): string {
  return i18n.t(scope, options);
}
