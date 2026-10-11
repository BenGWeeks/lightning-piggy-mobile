import { I18n } from 'i18n-js';
import { createI18nInstance } from '.';
import { CARDINAL_RULES, pluralKeys, registerPluralRules, type PluralLocale } from './plurals';

const COUNTS = [1, 2, 4, 5, 11, 12, 21, 22, 25];

describe('CLDR plural categories', () => {
  it.each([
    // n:      1      2      4      5       11      12      21      22     25
    ['uk', ['one', 'few', 'few', 'many', 'many', 'many', 'one', 'few', 'many']],
    ['pl', ['one', 'few', 'few', 'many', 'many', 'many', 'many', 'few', 'many']],
  ] as const)('%s picks one/few/many like a native speaker', (locale, expected) => {
    expect(COUNTS.map((n) => CARDINAL_RULES[locale](n))).toEqual(expected);
  });

  it('Chinese has a single form', () => {
    for (const n of [0, 1, 2, 5, 21]) expect(CARDINAL_RULES['zh-Hans'](n)).toBe('other');
  });

  it.each(['de', 'hu', 'en', 'es'] as const)('%s uses one for 1 and other otherwise', (locale) => {
    expect([0, 1, 2, 5, 21].map((n) => CARDINAL_RULES[locale](n))).toEqual([
      'other',
      'one',
      'other',
      'other',
      'other',
    ]);
  });

  it.each(['hi', 'mr'] as const)('%s uses one for 1 and other for 2+', (locale) => {
    expect(CARDINAL_RULES[locale](1)).toBe('one');
    for (const n of [2, 5, 21]) expect(CARDINAL_RULES[locale](n)).toBe('other');
  });

  // Hermes has no Intl.PluralRules, so the app ships make-plural's CLDR
  // table. Node does have it: prove the two agree for every locale we ship.
  it.each(Object.keys(CARDINAL_RULES) as PluralLocale[])(
    '%s matches Intl.PluralRules',
    (locale) => {
      const intl = new Intl.PluralRules(locale);
      for (let n = 0; n <= 300; n++)
        expect(`${n}:${CARDINAL_RULES[locale](n)}`).toBe(`${n}:${intl.select(n)}`);
      for (const n of [0.5, 1.5, 2.5]) {
        expect(`${n}:${CARDINAL_RULES[locale](String(n))}`).toBe(`${n}:${intl.select(n)}`);
      }
    },
  );
});

describe('pluralKeys fallback order', () => {
  it('tries zero first for 0, then the CLDR category, then other, then one', () => {
    expect(pluralKeys('uk', 0)).toEqual(['zero', 'many', 'other', 'one']);
    expect(pluralKeys('uk', 3)).toEqual(['few', 'other', 'one']);
    expect(pluralKeys('en', 1)).toEqual(['one', 'other']);
    expect(pluralKeys('zh-Hans', 1)).toEqual(['other', 'one']);
  });

  it('degrades few/many to other, then one, instead of a missing-translation string', () => {
    const i18n = new I18n({
      uk: { onlyOneOther: { one: '%{count} one', other: '%{count} other' } },
      pl: { onlyOne: { one: '%{count} one' } },
    });
    registerPluralRules(i18n);
    expect(i18n.t('onlyOneOther', { count: 5, locale: 'uk' })).toBe('5 other');
    expect(i18n.t('onlyOne', { count: 5, locale: 'pl' })).toBe('5 one');
  });
});

describe('catalogue plurals end to end', () => {
  it.each([
    [1, '1 відгук'],
    [2, '2 відгуки'],
    [4, '4 відгуки'],
    [5, '5 відгуків'],
    [11, '11 відгуків'],
    [12, '12 відгуків'],
    [21, '21 відгук'],
    [22, '22 відгуки'],
    [25, '25 відгуків'],
  ])('uk: %i reviews → %s', (count, expected) => {
    expect(createI18nInstance('uk').t('market.reviews.count', { count })).toBe(expected);
  });

  it.each([
    [1, '1 opinia'],
    [2, '2 opinie'],
    [4, '4 opinie'],
    [5, '5 opinii'],
    [11, '11 opinii'],
    [12, '12 opinii'],
    [21, '21 opinii'],
    [22, '22 opinie'],
    [25, '25 opinii'],
  ])('pl: %i reviews → %s', (count, expected) => {
    expect(createI18nInstance('pl').t('market.reviews.count', { count })).toBe(expected);
  });

  it('zh-Hans: resolves the script-keyed catalogue and uses its single form', () => {
    const zh = createI18nInstance('zh-Hans');
    expect(zh.t('tabs.home')).toBe('首页');
    expect(zh.t('market.reviews.count', { count: 1 })).toBe('1条评价');
    expect(zh.t('market.reviews.count', { count: 5 })).toBe('5条评价');
  });

  it('keeps the dedicated zero message', () => {
    expect(createI18nInstance('en').t('invitationKeys.removeOld', { count: 0 })).toBe(
      'Remove old devices',
    );
    expect(createI18nInstance('en').t('invitationKeys.removeOld', { count: 2 })).toBe(
      'Remove 2 old devices',
    );
  });
});
