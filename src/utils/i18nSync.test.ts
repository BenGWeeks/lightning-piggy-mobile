import {
  buildTaskFile,
  detectLocale,
  expectedLeaves,
  extractJsonObject,
  flatten,
  hasWork,
  mergeCatalogue,
  parseSupportedLocales,
  placeholders,
  requiredPluralCategories,
  planApply,
  proposalsFrom,
  validateCatalogue,
  validateEntry,
  type Catalogue,
} from './i18nSync';

const en: Catalogue = {
  tabs: { home: 'Home', friends: 'Friends' },
  greet: 'Hello, {{name}}!',
  reviews: { one: '{{count}} review', other: '{{count}} reviews' },
};

const es: Catalogue = {
  tabs: { home: 'Inicio', friends: 'Amigos' },
  greet: '¡Hola, {{name}}!',
  reviews: { one: '{{count}} reseña', other: '{{count}} reseñas' },
};

const detect = (overrides: Partial<Parameters<typeof detectLocale>[0]>) =>
  detectLocale({
    locale: 'es',
    en,
    baseEn: en,
    localeTree: es,
    baseLocaleTree: es,
    categories: ['one', 'other'],
    ...overrides,
  });

describe('placeholders', () => {
  it('collects both interpolation syntaxes, sorted', () => {
    expect(placeholders('%{count} of {{total}} for {{name}}')).toBe('%{count},{{name}},{{total}}');
    expect(placeholders('none')).toBe('');
  });

  it('treats whitespace inside the braces as a different variable (as i18n-js does)', () => {
    expect(placeholders('{{ name }}')).not.toBe(placeholders('{{name}}'));
  });
});

describe('requiredPluralCategories', () => {
  it('matches the forms whole counts need per CLDR', () => {
    expect(requiredPluralCategories('en')).toEqual(['one', 'other']);
    expect(requiredPluralCategories('es')).toEqual(['one', 'other']);
    expect(requiredPluralCategories('uk')).toEqual(['one', 'few', 'many', 'other']);
    expect(requiredPluralCategories('pl')).toEqual(['one', 'few', 'many', 'other']);
    expect(requiredPluralCategories('zh-Hans')).toEqual(['other']);
  });
});

describe('expectedLeaves', () => {
  it('adds the extra plural forms a locale needs, sourced from en `other`', () => {
    const leaves = expectedLeaves(en, ['one', 'few', 'many', 'other']);
    expect(leaves.get('reviews.few')).toEqual({
      sourcePath: 'reviews.other',
      source: '{{count}} reviews',
    });
    expect(leaves.has('reviews.many')).toBe(true);
    expect(leaves.get('tabs.home')?.source).toBe('Home');
  });
});

describe('detectLocale', () => {
  it('reports nothing for an in-sync catalogue', () => {
    const diff = detect({});
    expect(hasWork(diff)).toBe(false);
  });

  it('flags missing and empty strings', () => {
    const diff = detect({ localeTree: { ...es, tabs: { home: '  ' }, greet: '¡Hola, {{name}}!' } });
    expect(diff.missing.map((e) => e.path)).toEqual(['tabs.home', 'tabs.friends']);
    expect(diff.missing[0]).toEqual({ path: 'tabs.home', reason: 'missing', en: 'Home' });
  });

  it('flags stale keys but allows optional extra CLDR forms', () => {
    const diff = detect({
      localeTree: {
        ...es,
        gone: 'Adiós',
        tabs: { ...(es.tabs as Catalogue), old: 'Viejo' },
        reviews: { ...(es.reviews as Catalogue), many: '{{count}} de reseñas' },
      },
    });
    expect(diff.stale).toEqual(['tabs.old', 'gone']);
  });

  it('flags a reworded English string whose translation did not change', () => {
    const newEn = { ...en, tabs: { home: 'Home', friends: 'Family & friends' } };
    const diff = detect({ en: newEn });
    expect(diff.changed).toEqual([
      {
        path: 'tabs.friends',
        reason: 'changed',
        en: 'Family & friends',
        previousEn: 'Friends',
        previous: 'Amigos',
      },
    ]);
  });

  it('treats the change as handled once the translation was updated too', () => {
    const newEn = { ...en, tabs: { home: 'Home', friends: 'Family & friends' } };
    const newEs = { ...es, tabs: { home: 'Inicio', friends: 'Familia y amigos' } };
    expect(detect({ en: newEn, localeTree: newEs }).changed).toEqual([]);
  });

  it('flags a few/many form when en `other` was reworded', () => {
    const uk = {
      ...es,
      reviews: { one: 'a', few: 'b {{count}}', many: 'c {{count}}', other: 'd' },
    };
    const newEn = { ...en, reviews: { one: '{{count}} review', other: '{{count}} ratings' } };
    const diff = detect({
      en: newEn,
      localeTree: uk,
      baseLocaleTree: uk,
      categories: ['one', 'few', 'many', 'other'],
    });
    expect(diff.changed.map((e) => e.path)).toEqual([
      'reviews.other',
      'reviews.few',
      'reviews.many',
    ]);
  });

  it('flags an optional plural form the locale keeps when en `other` was reworded', () => {
    const withMany = {
      ...es,
      reviews: {
        one: '{{count}} reseña',
        many: '{{count}} de reseñas',
        other: '{{count}} reseñas',
      },
    };
    const newEn = { ...en, reviews: { one: '{{count}} review', other: '{{count}} ratings' } };
    const diff = detect({ en: newEn, localeTree: withMany, baseLocaleTree: withMany });
    expect(diff.changed.map((e) => e.path)).toEqual(['reviews.other', 'reviews.many']);
    expect(diff.stale).toEqual([]);
  });

  it('skips changed detection without a base, or for a locale new on this branch', () => {
    const newEn = { ...en, greet: 'Hi, {{name}}!' };
    expect(detect({ en: newEn, baseEn: null }).changed).toEqual([]);
    expect(detect({ en: newEn, baseLocaleTree: null }).changed).toEqual([]);
  });
});

describe('buildTaskFile / proposalsFrom', () => {
  it('round-trips: a filled task file yields its proposals with their English', () => {
    const diff = detect({ localeTree: { ...es, greet: '' } });
    const task = buildTaskFile(diff, 'abc123');
    expect(task.base).toBe('abc123');
    expect(task.entries.greet).toEqual({
      reason: 'missing',
      en: 'Hello, {{name}}!',
      translation: '',
    });
    expect(proposalsFrom(task)).toEqual({});
    task.entries.greet.translation = '¡Hola, {{name}}!';
    expect(proposalsFrom(task)).toEqual({
      greet: { translation: '¡Hola, {{name}}!', en: 'Hello, {{name}}!' },
    });
  });

  it('keeps hand-filled translations when regenerated, unless the English changed', () => {
    const diff = detect({ localeTree: { ...es, greet: '', tabs: {} } });
    const first = buildTaskFile(diff, null);
    first.entries.greet.translation = '¡Hola, {{name}}!';
    first.entries['tabs.home'].translation = 'Inicio';
    first.entries['tabs.home'].en = 'Old home';
    const again = buildTaskFile(diff, null, first);
    expect(again.entries.greet.translation).toBe('¡Hola, {{name}}!');
    expect(again.entries['tabs.home'].translation).toBe('');
  });

  it('reads a flat draft and ignores non-string / empty values', () => {
    expect(proposalsFrom({ a: 'x', b: '', c: 3 })).toEqual({ a: { translation: 'x' } });
    expect(proposalsFrom(null)).toEqual({});
  });
});

describe('validateEntry', () => {
  it('accepts a translation that keeps every placeholder', () => {
    expect(validateEntry('greet', '¡Hola, {{name}}!', 'Hello, {{name}}!')).toBeNull();
  });
  it('rejects empty strings and placeholder drift', () => {
    expect(validateEntry('greet', ' ', 'Hello, {{name}}!')).toBe('empty greet');
    expect(validateEntry('greet', '¡Hola!', 'Hello, {{name}}!')).toMatch(/^placeholders greet/);
  });
});

describe('planApply', () => {
  const newEn = { ...en, tabs: { home: 'Home', friends: 'Family & friends' } };
  const diff = detect({ en: newEn, localeTree: { ...es, greet: '' } });

  it('accepts valid proposals for keys that still need translating', () => {
    const plan = planApply(diff, {
      greet: { translation: '¡Hola, {{name}}!', en: 'Hello, {{name}}!' },
      'tabs.friends': { translation: 'Familia y amigos' },
    });
    expect(plan).toEqual({
      accepted: { greet: '¡Hola, {{name}}!', 'tabs.friends': 'Familia y amigos' },
      rejected: [],
      skipped: [],
      unresolved: [],
    });
  });

  it('never touches keys that no longer need translating', () => {
    const plan = planApply(diff, { 'tabs.home': { translation: 'Casa' } });
    expect(plan.accepted).toEqual({});
    expect(plan.skipped).toEqual(['tabs.home']);
  });

  it('refuses proposals drafted against different English, or with bad placeholders', () => {
    const plan = planApply(diff, {
      'tabs.friends': { translation: 'Amigos', en: 'Friends' },
      greet: { translation: '¡Hola!' },
    });
    expect(plan.accepted).toEqual({});
    expect(plan.rejected).toEqual([
      'outdated tabs.friends: drafted for "Friends", English is now "Family & friends"',
      'placeholders greet: expected "{{name}}", got ""',
    ]);
  });

  it('lists reworded strings that still have no new translation', () => {
    expect(planApply(diff, {}).unresolved).toEqual(['tabs.friends']);
  });
});

describe('mergeCatalogue', () => {
  it('applies translations, drops stale keys and restores en key order', () => {
    const shuffled: Catalogue = {
      stale: 'x',
      reviews: {
        other: '{{count}} reseñas',
        many: '{{count}} de reseñas',
        one: '{{count}} reseña',
      },
      greet: '¡Hola, {{name}}!',
      tabs: { friends: 'Amigos' },
    };
    const merged = mergeCatalogue(en, shuffled, { 'tabs.home': 'Inicio' });
    expect(JSON.stringify(merged)).toBe(
      JSON.stringify({
        tabs: { home: 'Inicio', friends: 'Amigos' },
        greet: '¡Hola, {{name}}!',
        reviews: {
          one: '{{count}} reseña',
          many: '{{count}} de reseñas',
          other: '{{count}} reseñas',
        },
      }),
    );
  });

  it('adds new plural forms in CLDR order and leaves untranslated leaves absent', () => {
    const merged = mergeCatalogue(
      en,
      { tabs: { home: 'Inicio' } },
      { 'reviews.few': 'f {{count}}' },
    );
    expect(merged).toEqual({ tabs: { home: 'Inicio' }, reviews: { few: 'f {{count}}' } });
    expect(Object.keys(merged)).toEqual(['tabs', 'reviews']);
  });

  it('lets a translation override the existing value', () => {
    expect(flatten(mergeCatalogue(en, es, { 'tabs.friends': 'Familia' })).get('tabs.friends')).toBe(
      'Familia',
    );
  });
});

describe('validateCatalogue', () => {
  it('passes a valid catalogue', () => {
    expect(validateCatalogue(en, es, ['one', 'other'])).toEqual([]);
  });

  it('reports every class of problem', () => {
    const bad: Catalogue = {
      tabs: 'oops',
      greet: '¡Hola!',
      reviews: { one: '{{count}} reseña', few: '', other: '' },
      extra: 'x',
    };
    expect(validateCatalogue(en, bad, ['one', 'few', 'many', 'other'])).toEqual([
      'not an object tabs',
      'placeholders greet',
      'empty reviews.other',
      'empty reviews.few',
      'plural reviews lacks "many"',
      'extra extra',
    ]);
  });

  it('checks extra plural forms against en `other` placeholders', () => {
    const tree = { ...es, reviews: { one: '{{count}} a', few: 'no count', other: '{{count}} b' } };
    expect(validateCatalogue(en, tree, ['one', 'other'])).toEqual(['placeholders reviews.few']);
  });

  it('reports a string where en has an object, and missing keys', () => {
    expect(validateCatalogue(en, { greet: { a: 'b' } }, ['other'])).toEqual([
      'missing tabs',
      'not a string greet',
      'missing reviews',
    ]);
  });
});

describe('parseSupportedLocales', () => {
  it('reads the list from src/i18n/index.ts source', () => {
    const src = "export const SUPPORTED_LOCALES = ['en', \"zh-Hans\", 'uk'] as const;";
    expect(parseSupportedLocales(src)).toEqual(['en', 'zh-Hans', 'uk']);
  });

  it('matches the real index.ts', () => {
    const { SUPPORTED_LOCALES } = jest.requireActual('../i18n');
    const fs = jest.requireActual('fs');
    const path = jest.requireActual('path');
    const src = fs.readFileSync(path.join(__dirname, '../i18n/index.ts'), 'utf8');
    expect(parseSupportedLocales(src)).toEqual([...SUPPORTED_LOCALES]);
  });

  it('throws when the constant is gone', () => {
    expect(() => parseSupportedLocales('nothing here')).toThrow(/SUPPORTED_LOCALES/);
  });
});

describe('extractJsonObject', () => {
  it('parses a bare object, a fenced one, or one wrapped in prose', () => {
    expect(extractJsonObject('{"a":"b"}')).toEqual({ a: 'b' });
    expect(extractJsonObject('Here:\n```json\n{"a":"b"}\n```')).toEqual({ a: 'b' });
    expect(extractJsonObject('Sure! {"a":"{{x}}"} done')).toEqual({ a: '{{x}}' });
  });

  it('throws on replies without an object', () => {
    expect(() => extractJsonObject('sorry')).toThrow(/no JSON object/);
    expect(() => extractJsonObject('{not json}')).toThrow();
  });
});
