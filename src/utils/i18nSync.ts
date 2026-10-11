// Pure logic behind `npm run i18n:sync` (scripts/i18n-sync.mjs, #1313).
//
// The script is a thin I/O wrapper (git, files, CLIs); everything that
// decides WHAT needs translating, HOW translations merge back and WHETHER a
// catalogue is valid lives here so Jest can cover it. Keep this module free
// of imports: the script loads it straight from Node with type stripping
// (`node --experimental-strip-types`), which can't resolve app modules.
//
// Not used by the app at runtime. `requiredPluralCategories` relies on
// `Intl.PluralRules`, which Node and Jest have but Hermes doesn't.

export type Catalogue = { [key: string]: string | Catalogue };

/** CLDR plural categories, in CLDR order (the order merged files use). */
export const CLDR_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;

const CLDR_SET: ReadonlySet<string> = new Set(CLDR_CATEGORIES);

/** A plural object: every key is a CLDR category (`{ one, other }`). */
export function isPluralObject(node: Catalogue): boolean {
  const keys = Object.keys(node);
  return keys.length > 0 && keys.every((k) => CLDR_SET.has(k));
}

/** Leaf strings by dot path (`tabs.home` → "Home"). */
export function flatten(tree: Catalogue, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

/** Sorted `{{name}}` / `%{name}` interpolations — i18n-js supports both. */
export function placeholders(s: string): string {
  return (s.match(/\{\{\s*[\w.]+\s*\}\}|%\{\s*\w+\s*\}/g) ?? [])
    .map((p) => p.replace(/\s+/g, ''))
    .sort()
    .join(',');
}

/**
 * Plural categories a locale's plural objects must define: every category a
 * whole count 0-200 can hit, plus `other` (same bar as the catalogue guard).
 * Edge categories such as Spanish `many` (exact millions) are optional.
 */
export function requiredPluralCategories(locale: string): string[] {
  const rules = new Intl.PluralRules(locale);
  const needed = new Set<string>(['other']);
  for (let n = 0; n <= 200; n++) needed.add(rules.select(n));
  return CLDR_CATEGORIES.filter((c) => needed.has(c));
}

/** One string a locale must have, and the English it's translated from. */
export interface ExpectedLeaf {
  /** en path whose text is the source (a `few`/`many` form uses en's `other`). */
  sourcePath: string;
  source: string;
}

/**
 * Every leaf path a locale catalogue must define: all of en's leaves, plus
 * the extra CLDR categories the locale's plural rules need (e.g. `few` and
 * `many` for Polish and Ukrainian), sourced from en's `other` form.
 */
export function expectedLeaves(en: Catalogue, categories: string[]): Map<string, ExpectedLeaf> {
  const out = new Map<string, ExpectedLeaf>();
  const walk = (node: Catalogue, prefix: string) => {
    for (const [key, value] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof value === 'string') out.set(path, { sourcePath: path, source: value });
      else walk(value, path);
    }
    if (prefix && isPluralObject(node) && typeof node.other === 'string') {
      for (const category of categories) {
        if (!(category in node)) {
          out.set(`${prefix}.${category}`, {
            sourcePath: `${prefix}.other`,
            source: node.other,
          });
        }
      }
    }
  };
  walk(en, '');
  return out;
}

/** True if `path` is an optional extra CLDR form inside an en plural object. */
function isOptionalPluralForm(en: Catalogue, path: string): boolean {
  const dot = path.lastIndexOf('.');
  if (dot < 0 || !CLDR_SET.has(path.slice(dot + 1))) return false;
  let node: string | Catalogue | undefined = en;
  for (const key of path.slice(0, dot).split('.')) {
    if (typeof node !== 'object' || node === null) return false;
    node = node[key];
  }
  return typeof node === 'object' && node !== null && isPluralObject(node);
}

export type TodoReason = 'missing' | 'changed';

export interface TodoEntry {
  path: string;
  reason: TodoReason;
  /** Current English source text. */
  en: string;
  /** English text at the merge base, for `changed` entries. */
  previousEn?: string;
  /** The locale's current (now outdated) translation, if any. */
  previous?: string;
}

export interface LocaleDiff {
  locale: string;
  missing: TodoEntry[];
  changed: TodoEntry[];
  /** Paths the locale has that en no longer does. */
  stale: string[];
}

export interface DetectInput {
  locale: string;
  en: Catalogue;
  /** en.json at the merge base; `null` skips changed-text detection. */
  baseEn: Catalogue | null;
  localeTree: Catalogue;
  /** The locale file at the merge base; `null` if it didn't exist there. */
  baseLocaleTree: Catalogue | null;
  categories: string[];
}

/**
 * What a locale needs: missing (or empty) strings, stale paths, and strings
 * whose English changed since the merge base while the translation didn't —
 * a reworded string keeps its key, so parity checks alone miss it.
 */
export function detectLocale(input: DetectInput): LocaleDiff {
  const { locale, en, baseEn, localeTree, baseLocaleTree, categories } = input;
  const expected = expectedLeaves(en, categories);
  const localeFlat = flatten(localeTree);
  const baseEnFlat = baseEn ? flatten(baseEn) : null;
  const baseLocaleFlat = baseLocaleTree ? flatten(baseLocaleTree) : null;

  const missing: TodoEntry[] = [];
  const changed: TodoEntry[] = [];
  for (const [path, { sourcePath, source }] of expected) {
    const current = localeFlat.get(path);
    if (current === undefined || !current.trim()) {
      missing.push({ path, reason: 'missing', en: source });
      continue;
    }
    const previousEn = baseEnFlat?.get(sourcePath);
    if (previousEn === undefined || previousEn === source || !baseLocaleFlat) continue;
    // The translation was updated alongside the English: already handled.
    if (baseLocaleFlat.get(path) !== current) continue;
    changed.push({ path, reason: 'changed', en: source, previousEn, previous: current });
  }

  const stale = [...localeFlat.keys()].filter(
    (path) => !expected.has(path) && !isOptionalPluralForm(en, path),
  );
  return { locale, missing, changed, stale };
}

export function hasWork(diff: LocaleDiff): boolean {
  return diff.missing.length + diff.changed.length + diff.stale.length > 0;
}

/** The `.i18n-todo/<locale>.json` file a translator (or `--draft`) fills in. */
export interface TaskFile {
  locale: string;
  /** Merge-base commit changed-text detection compared against. */
  base: string | null;
  instructions: string;
  entries: Record<string, Omit<TodoEntry, 'path'> & { translation: string }>;
  /** Paths `--apply` will delete (informational). */
  stale: string[];
}

export const TASK_INSTRUCTIONS =
  'Fill in "translation" for each entry (follow docs/i18n/GLOSSARY.md), then run ' +
  '`npm run i18n:sync -- --apply`. Keep every {{placeholder}} / %{placeholder} exactly.';

export function buildTaskFile(diff: LocaleDiff, base: string | null): TaskFile {
  const entries: TaskFile['entries'] = {};
  for (const { path, ...rest } of [...diff.missing, ...diff.changed]) {
    entries[path] = { ...rest, translation: '' };
  }
  return {
    locale: diff.locale,
    base,
    instructions: TASK_INSTRUCTIONS,
    entries,
    stale: diff.stale,
  };
}

/** Translations from a draft (`{ path: text }`) or a filled-in task file. */
export function translationsFrom(file: unknown): Record<string, string> {
  if (!file || typeof file !== 'object') return {};
  const record = file as Record<string, unknown>;
  const out: Record<string, string> = {};
  if (record.entries && typeof record.entries === 'object') {
    for (const [path, entry] of Object.entries(record.entries as Record<string, unknown>)) {
      const translation = (entry as { translation?: unknown } | null)?.translation;
      if (typeof translation === 'string' && translation.trim()) out[path] = translation;
    }
    return out;
  }
  for (const [path, value] of Object.entries(record)) {
    if (typeof value === 'string' && value.trim()) out[path] = value;
  }
  return out;
}

/** Problems with one proposed translation (empty, unknown key, placeholders). */
export function validateEntry(
  path: string,
  translation: string,
  expected: Map<string, ExpectedLeaf>,
): string | null {
  const leaf = expected.get(path);
  if (!leaf) return `unknown key ${path}`;
  if (!translation.trim()) return `empty ${path}`;
  if (placeholders(translation) !== placeholders(leaf.source)) {
    return `placeholders ${path}: expected "${placeholders(leaf.source)}", got "${placeholders(translation)}"`;
  }
  return null;
}

/**
 * Merge `translations` (flat paths) into a locale catalogue, rebuilt in
 * en.json's key order. Stale keys are dropped; plural objects keep any CLDR
 * forms the locale has, in CLDR order. Leaves with no value stay absent so
 * validation reports them.
 */
export function mergeCatalogue(
  en: Catalogue,
  localeTree: Catalogue,
  translations: Record<string, string>,
): Catalogue {
  const existing = flatten(localeTree);
  const valueAt = (path: string) => translations[path] ?? existing.get(path);

  const build = (enNode: Catalogue, prefix: string): Catalogue => {
    const out: Catalogue = {};
    const keys = isPluralObject(enNode)
      ? CLDR_CATEGORIES.filter(
          (c) => c in enNode || valueAt(prefix ? `${prefix}.${c}` : c) !== undefined,
        )
      : Object.keys(enNode);
    for (const key of keys) {
      const path = prefix ? `${prefix}.${key}` : key;
      const enValue = enNode[key];
      if (enValue !== undefined && typeof enValue !== 'string') {
        const child = build(enValue, path);
        if (Object.keys(child).length > 0) out[key] = child;
      } else {
        const value = valueAt(path);
        if (value !== undefined) out[key] = value;
      }
    }
    return out;
  };
  return build(en, '');
}

/**
 * Everything wrong with a locale catalogue: missing / extra keys, wrong
 * shapes, empty strings, placeholder drift and missing plural categories.
 * Mirrors the catalogue guard so `--apply` fails before CI does.
 */
export function validateCatalogue(en: Catalogue, tree: Catalogue, categories: string[]): string[] {
  const errors: string[] = [];
  const walk = (ref: Catalogue, node: Catalogue, prefix: string) => {
    for (const [key, value] of Object.entries(ref)) {
      const path = prefix ? `${prefix}.${key}` : key;
      const other = node[key];
      if (other === undefined) errors.push(`missing ${path}`);
      else if (typeof value === 'string') {
        if (typeof other !== 'string') errors.push(`not a string ${path}`);
        else if (!other.trim()) errors.push(`empty ${path}`);
        else if (placeholders(value) !== placeholders(other)) {
          errors.push(`placeholders ${path}`);
        }
      } else if (typeof other === 'string') errors.push(`not an object ${path}`);
      else walk(value, other, path);
    }
    const plural = isPluralObject(ref);
    for (const key of Object.keys(node)) {
      if (key in ref) continue;
      const path = prefix ? `${prefix}.${key}` : key;
      if (!(plural && CLDR_SET.has(key))) {
        errors.push(`extra ${path}`);
        continue;
      }
      const value = node[key];
      if (typeof value !== 'string' || !value.trim()) errors.push(`empty ${path}`);
      else if (typeof ref.other === 'string' && placeholders(ref.other) !== placeholders(value)) {
        errors.push(`placeholders ${path}`);
      }
    }
    if (plural) {
      for (const category of categories) {
        if (!(category in node)) errors.push(`plural ${prefix} lacks "${category}"`);
      }
    }
  };
  walk(en, tree, '');
  return errors;
}

/** `SUPPORTED_LOCALES = ['en', 'es'] as const` → `['en', 'es']`. */
export function parseSupportedLocales(indexSource: string): string[] {
  const match = indexSource.match(/SUPPORTED_LOCALES\s*=\s*\[([^\]]*)\]/);
  if (!match) throw new Error('SUPPORTED_LOCALES not found in src/i18n/index.ts');
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

/**
 * The JSON object in a CLI's reply — tolerates prose or a ```json fence
 * around it. Throws if there's no parseable object.
 */
export function extractJsonObject(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in reply');
  const parsed: unknown = JSON.parse(body.slice(start, end + 1));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('reply is not a JSON object');
  }
  return parsed as Record<string, unknown>;
}
