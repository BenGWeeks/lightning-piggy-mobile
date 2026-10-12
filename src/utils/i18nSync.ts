// Pure logic behind `npm run i18n:sync` (scripts/i18n-sync.mjs, #1313).
//
// The script is a thin I/O wrapper (git, files, CLIs); everything that
// decides WHAT needs translating, HOW translations merge back and WHETHER a
// catalogue is valid lives here so Jest can cover it. Keep this module free
// of imports: the script loads it straight from Node with type stripping
// (`node --experimental-strip-types`), which can't resolve app modules.
//
// Not used by the app at runtime.

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

/**
 * Sorted `{{name}}` / `%{name}` interpolations — i18n-js supports both.
 * Compared verbatim: i18n-js reads `{{ name }}` as the variable " name ", so
 * whitespace inside the braces is a real difference.
 */
export function placeholders(s: string): string {
  return (s.match(/\{\{[^{}]*\}\}|%\{[^{}]*\}/g) ?? []).sort().join(',');
}

/** CLDR cardinal rule: count → plural category (`CARDINAL_RULES[locale]`). */
export type CardinalRule = (n: number) => string;

/**
 * Which counts each required category covers under the app's runtime rule,
 * for the drafting prompt — e.g. `one: 1, 21, 31…; few: 2, 3, 4, 22…` — so
 * every form (notably `other`) is written with the meaning the app gives it.
 * `rule` and `categories` come from src/i18n/plurals.ts, the single source
 * of truth shared with the runtime and the catalogue guard.
 */
export function pluralGuide(rule: CardinalRule, categories: readonly string[]): string {
  const samples = new Map<string, number[]>();
  for (let n = 0; n <= 30; n++) {
    const category = rule(n);
    samples.set(category, [...(samples.get(category) ?? []), n]);
  }
  const parts = categories.map((category) => {
    const counts = samples.get(category) ?? [];
    const list = counts.length
      ? `${counts.slice(0, 6).join(', ')}${counts.length > 6 ? '…' : ''}`
      : 'fractions only';
    return `${category}: ${list}`;
  });
  return `${parts.join('; ')} (a "zero" form, where en has one, is used for 0)`;
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
export function expectedLeaves(
  en: Catalogue,
  categories: readonly string[],
): Map<string, ExpectedLeaf> {
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

/**
 * For an optional extra CLDR form inside an en plural object (e.g. Spanish
 * `many`), its source: en's `other` of that object. Otherwise null.
 */
function optionalPluralSource(en: Catalogue, path: string): ExpectedLeaf | null {
  const dot = path.lastIndexOf('.');
  if (dot < 0 || !CLDR_SET.has(path.slice(dot + 1))) return null;
  let node: string | Catalogue | undefined = en;
  for (const key of path.slice(0, dot).split('.')) {
    if (typeof node !== 'object' || node === null) return null;
    node = node[key];
  }
  if (typeof node !== 'object' || node === null || !isPluralObject(node)) return null;
  const other = node.other;
  return typeof other === 'string'
    ? { sourcePath: `${path.slice(0, dot)}.other`, source: other }
    : null;
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
  categories: readonly string[];
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

  // Optional plural forms the locale already has are kept, so they must
  // follow English rewording too.
  const sources = new Map(expected);
  const stale: string[] = [];
  for (const path of localeFlat.keys()) {
    if (expected.has(path)) continue;
    const optional = optionalPluralSource(en, path);
    if (optional) sources.set(path, optional);
    else stale.push(path);
  }

  const missing: TodoEntry[] = [];
  const changed: TodoEntry[] = [];
  for (const [path, { sourcePath, source }] of sources) {
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

/**
 * The task file for a diff. Translations already filled in an earlier task
 * file (`previous`) carry over while their English source is unchanged, so
 * re-running the sync never discards work in progress.
 */
export function buildTaskFile(diff: LocaleDiff, base: string | null, previous?: unknown): TaskFile {
  const kept = proposalsFrom(previous);
  const entries: TaskFile['entries'] = {};
  for (const { path, ...rest } of [...diff.missing, ...diff.changed]) {
    const old = kept[path];
    entries[path] = { ...rest, translation: old && old.en === rest.en ? old.translation : '' };
  }
  return {
    locale: diff.locale,
    base,
    instructions: TASK_INSTRUCTIONS,
    entries,
    stale: diff.stale,
  };
}

/** A proposed translation, with the English it was written against if known. */
export interface Proposal {
  translation: string;
  en?: string;
}

/**
 * Proposals from a filled-in task / draft file (entries carry the English
 * they were translated from) or a hand-written flat `{ path: text }` map.
 */
export function proposalsFrom(file: unknown): Record<string, Proposal> {
  if (!file || typeof file !== 'object') return {};
  const record = file as Record<string, unknown>;
  const out: Record<string, Proposal> = {};
  if (record.entries && typeof record.entries === 'object') {
    for (const [path, raw] of Object.entries(record.entries as Record<string, unknown>)) {
      const entry = raw as { translation?: unknown; en?: unknown } | null;
      if (typeof entry?.translation === 'string' && entry.translation.trim()) {
        out[path] = {
          translation: entry.translation,
          ...(typeof entry.en === 'string' ? { en: entry.en } : {}),
        };
      }
    }
    return out;
  }
  for (const [path, value] of Object.entries(record)) {
    if (typeof value === 'string' && value.trim()) out[path] = { translation: value };
  }
  return out;
}

/**
 * Combine task-file and draft proposals. A non-empty translation in the task
 * file — where reviewers correct drafts — always wins over the draft;
 * `overridden` lists keys where the two disagree, so the script can say so.
 */
export function combineProposals(
  fromTask: Record<string, Proposal>,
  fromDraft: Record<string, Proposal>,
): { proposals: Record<string, Proposal>; overridden: string[] } {
  const overridden = Object.keys(fromTask).filter(
    (path) => path in fromDraft && fromDraft[path].translation !== fromTask[path].translation,
  );
  return { proposals: { ...fromDraft, ...fromTask }, overridden };
}

/** True when a locale has strings to translate (not just stale keys). */
export function needsTranslation(diff: LocaleDiff): boolean {
  return diff.missing.length + diff.changed.length > 0;
}

/** An earlier draft entry still applies if it was drafted for today's English. */
const draftStillValid = (old: Proposal | undefined, en: string): old is Proposal =>
  !!old && (old.en === undefined || old.en === en);

/**
 * Keys `--draft` should send to the CLI: empty in the task file, with no
 * earlier draft (possibly reviewer-corrected) for today's English — so a
 * re-run only retries what's still missing.
 */
export function pathsToDraft(task: TaskFile, existingDraft: unknown): string[] {
  const kept = proposalsFrom(existingDraft);
  return Object.entries(task.entries)
    .filter(([path, entry]) => !entry.translation.trim() && !draftStillValid(kept[path], entry.en))
    .map(([path]) => path);
}

/**
 * The draft file after a `--draft` run: earlier drafts (including reviewer
 * corrections) that still match today's English, plus the fresh ones. A
 * failed CLI call therefore never wipes an earlier draft.
 */
export function mergeDraftFile(
  task: TaskFile,
  existingDraft: unknown,
  fresh: Record<string, string>,
): TaskFile {
  const kept = proposalsFrom(existingDraft);
  const entries: TaskFile['entries'] = {};
  for (const [path, entry] of Object.entries(task.entries)) {
    const old = kept[path];
    if (draftStillValid(old, entry.en)) entries[path] = { ...entry, translation: old.translation };
    else if (path in fresh) entries[path] = { ...entry, translation: fresh[path] };
  }
  return { ...task, entries };
}

/** Problems with one translation of `source` (empty, placeholder drift). */
export function validateEntry(path: string, translation: string, source: string): string | null {
  if (!translation.trim()) return `empty ${path}`;
  if (placeholders(translation) !== placeholders(source)) {
    return `placeholders ${path}: expected "${placeholders(source)}", got "${placeholders(translation)}"`;
  }
  return null;
}

export interface ApplyPlan {
  /** Translations safe to merge, by path. */
  accepted: Record<string, string>;
  /** Proposals refused, with the reason. */
  rejected: string[];
  /** Proposals for keys that no longer need translating (left untouched). */
  skipped: string[];
  /** Reworded strings still without a new translation. */
  unresolved: string[];
}

/**
 * Decide which proposals `--apply` may merge. Only keys the locale still
 * needs (missing or changed) are touched — a leftover draft can never
 * overwrite a translation that's since been reviewed — and a proposal
 * written against different English than today's is refused.
 */
export function planApply(diff: LocaleDiff, proposals: Record<string, Proposal>): ApplyPlan {
  const needed = new Map([...diff.missing, ...diff.changed].map((e) => [e.path, e]));
  const plan: ApplyPlan = { accepted: {}, rejected: [], skipped: [], unresolved: [] };
  for (const [path, { translation, en }] of Object.entries(proposals)) {
    const entry = needed.get(path);
    if (!entry) {
      plan.skipped.push(path);
      continue;
    }
    if (en !== undefined && en !== entry.en) {
      plan.rejected.push(`outdated ${path}: drafted for "${en}", English is now "${entry.en}"`);
      continue;
    }
    const problem = validateEntry(path, translation, entry.en);
    if (problem) plan.rejected.push(problem);
    else plan.accepted[path] = translation;
  }
  plan.unresolved = diff.changed.map((e) => e.path).filter((p) => !(p in plan.accepted));
  return plan;
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
export function validateCatalogue(
  en: Catalogue,
  tree: Catalogue,
  categories: readonly string[],
): string[] {
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
