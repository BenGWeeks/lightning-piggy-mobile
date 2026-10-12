import i18n, { intlLocaleFor, type SupportedLocale } from '../i18n';

/** Selected app locale for imperative service calls, synced after React commits. */
export function getAppFormatLocale(): string {
  return intlLocaleFor(i18n.locale as SupportedLocale);
}
