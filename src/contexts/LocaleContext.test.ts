import { resolveLocale } from './LocaleContext';
import {
  intlLocaleFor,
  isSupportedLocale,
  SUPPORTED_LOCALES,
  supportedLocaleForDevice,
} from '../i18n';

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

  it('maps every Chinese tag to Simplified (Traditional falls back to it for now)', () => {
    for (const tag of [
      'zh',
      'zh-CN',
      'zh-Hans',
      'zh-Hans-CN',
      'zh_CN',
      'zh-SG',
      'zh-Hant-TW',
      'zh-TW',
    ]) {
      expect(supportedLocaleForDevice(tag)).toBe('zh-Hans');
    }
    expect(resolveLocale('system', 'zh-Hans-CN')).toBe('zh-Hans');
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

describe('intlLocaleFor', () => {
  it('formats Marathi amounts with Western digits and Indian grouping', () => {
    // CLDR's default for mr is Devanagari digits (१२,३४,५६७).
    expect((1234567).toLocaleString(intlLocaleFor('mr'))).toBe('12,34,567');
  });

  it('passes other catalogue codes straight through to Intl', () => {
    expect(intlLocaleFor('de')).toBe('de');
    expect((1234567).toLocaleString(intlLocaleFor('de'))).toBe('1.234.567');
  });
});
