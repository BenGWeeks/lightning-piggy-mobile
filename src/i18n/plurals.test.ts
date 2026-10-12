import { I18n } from 'i18n-js';
import { createI18nInstance } from '.';
import {
  CARDINAL_RULES,
  pinCountlessSingulars,
  pluralKeys,
  requiredPluralCategories,
  registerPluralRules,
  type PluralLocale,
} from './plurals';

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
  it('tries zero (0) / =1 (1) first, then the CLDR category, then other, then one', () => {
    expect(pluralKeys('uk', 0)).toEqual(['zero', 'many', 'other', 'one']);
    expect(pluralKeys('uk', 3)).toEqual(['few', 'other', 'one']);
    expect(pluralKeys('en', 1)).toEqual(['=1', 'one', 'other']);
    expect(pluralKeys('uk', 21)).toEqual(['one', 'other']);
    expect(pluralKeys('zh-Hans', 1)).toEqual(['=1', 'other', 'one']);
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

describe('pinCountlessSingulars', () => {
  const tree = {
    group: { one: 'with the other person', other: 'with the {{count}} people' },
    reviews: { one: '{{count}} review', other: '{{count}} reviews' },
    label: 'unchanged',
  };

  it('pins a count-less one form to =1 where CLDR one covers other numbers', () => {
    expect(pinCountlessSingulars('uk', tree)).toEqual({
      group: { '=1': 'with the other person', other: 'with the {{count}} people' },
      reviews: tree.reviews,
      label: 'unchanged',
    });
  });

  it('leaves locales whose one means exactly 1 untouched', () => {
    expect(pinCountlessSingulars('en', tree)).toBe(tree);
    expect(pinCountlessSingulars('pl', tree)).toBe(tree);
  });

  it('uk: a 21-member group shows the count, a 1-member group the singular sentence', () => {
    const uk = createI18nInstance('uk');
    const one = uk.t('locationSharing.groupTitle', { group: 'G', count: 1 });
    const many = uk.t('locationSharing.groupTitle', { group: 'G', count: 21 });
    expect(one).not.toContain('1');
    expect(many).toContain('21');
    expect(uk.t('market.reviews.count', { count: 21 })).toBe('21 відгук');
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
    expect(zh.t('tabs.wallets')).toBe('钱包');
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

describe('requiredPluralCategories (shared with the catalogue tooling)', () => {
  it.each([
    ['uk', ['one', 'few', 'many', 'other']],
    ['pl', ['one', 'few', 'many', 'other']],
    ['de', ['one', 'other']],
    ['hu', ['one', 'other']],
    ['hi', ['one', 'other']],
    ['mr', ['one', 'other']],
    ['es', ['one', 'other']],
    ['en', ['one', 'other']],
    ['zh-Hans', ['other']],
  ])('%s needs %j', (locale, expected) => {
    expect(requiredPluralCategories(locale)).toEqual(expected);
  });

  it('throws for a locale without a CLDR rule', () => {
    expect(() => requiredPluralCategories('fr')).toThrow(/No CLDR plural rule/);
  });
});

// Through the real translate path: createI18nInstance is what LocaleContext
// renders with (useLocale().t), so this is the runtime, not a helper.
describe('runtime translate picks the CLDR form (1 / 2 / 5 / 21 / 22)', () => {
  const COUNTS_RT = [1, 2, 5, 21, 22];
  it.each([
    ['uk', ['1 відгук', '2 відгуки', '5 відгуків', '21 відгук', '22 відгуки']],
    ['pl', ['1 opinia', '2 opinie', '5 opinii', '21 opinii', '22 opinie']],
    ['de', ['1 Bewertung', '2 Bewertungen', '5 Bewertungen', '21 Bewertungen', '22 Bewertungen']],
    ['hu', ['1 értékelés', '2 értékelés', '5 értékelés', '21 értékelés', '22 értékelés']],
    ['zh-Hans', ['1条评价', '2条评价', '5条评价', '21条评价', '22条评价']],
    ['hi', ['1 रिव्यू', '2 रिव्यू', '5 रिव्यू', '21 रिव्यू', '22 रिव्यू']],
    ['mr', ['1 रिव्ह्यू', '2 रिव्ह्यू', '5 रिव्ह्यू', '21 रिव्ह्यू', '22 रिव्ह्यू']],
  ] as const)('%s market.reviews.count', (locale, expected) => {
    const t = createI18nInstance(locale);
    expect(COUNTS_RT.map((count) => t.t('market.reviews.count', { count }))).toEqual(expected);
  });

  // hu / hi / mr nouns don't change form, so prove the category choice on the
  // very instance the app uses: its registered pluralizer must follow CLDR.
  it.each(['uk', 'pl', 'hu', 'de', 'zh-Hans', 'hi', 'mr'] as const)(
    '%s instance has the CLDR pluralizer registered',
    (locale) => {
      const instance = createI18nInstance(locale);
      const pluralizer = instance.pluralization.get(locale);
      for (const n of [0, ...COUNTS_RT]) {
        expect(pluralizer(instance, n)).toContain(CARDINAL_RULES[locale](n));
      }
      // Not i18n-js's English default: Ukrainian 22 is `few`, Chinese 1 is `other`.
      if (locale === 'uk') expect(pluralizer(instance, 22)[0]).toBe('few');
      if (locale === 'zh-Hans') {
        expect(pluralizer(instance, 1).filter((k) => k !== '=1')[0]).toBe('other');
      }
    },
  );
});
