import { resolveLocale } from './LocaleContext';
import { isSupportedLocale, SUPPORTED_LOCALES, supportedLocaleForDevice } from '../i18n';

describe('isSupportedLocale (#137)', () => {
  it('accepts every code in SUPPORTED_LOCALES', () => {
    for (const code of SUPPORTED_LOCALES) {
      expect(isSupportedLocale(code)).toBe(true);
    }
  });

  it('rejects a language the app has no catalogue for', () => {
    expect(isSupportedLocale('fr')).toBe(false);
    expect(isSupportedLocale('it')).toBe(false);
    expect(isSupportedLocale('')).toBe(false);
  });
});

describe('resolveLocale (#137)', () => {
  it('follows the device language when preference is "system" and it is supported', () => {
    expect(resolveLocale('system', 'es')).toBe('es');
  });

  it('falls back to English when preference is "system" and the device language has no catalogue', () => {
    expect(resolveLocale('system', 'fr')).toBe('en');
  });

  it('falls back to English when preference is "system" and the device reports no language', () => {
    expect(resolveLocale('system', null)).toBe('en');
  });

  it('honours an explicit override regardless of the device language', () => {
    expect(resolveLocale('es', 'en')).toBe('es');
    expect(resolveLocale('en', 'es')).toBe('en');
  });
});

describe('supportedLocaleForDevice', () => {
  it('reduces a full device tag to its catalogue', () => {
    expect(supportedLocaleForDevice('es-MX')).toBe('es');
    expect(supportedLocaleForDevice('uk_UA')).toBe('uk');
    expect(supportedLocaleForDevice('EN-gb')).toBe('en');
  });

  it('returns null for a language without a catalogue, or no tag at all', () => {
    expect(supportedLocaleForDevice('fr-FR')).toBeNull();
    expect(supportedLocaleForDevice('')).toBeNull();
    expect(supportedLocaleForDevice(null)).toBeNull();
  });

  it('lets resolveLocale follow a full device tag', () => {
    expect(resolveLocale('system', 'es-419')).toBe('es');
  });
});
