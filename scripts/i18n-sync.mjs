#!/usr/bin/env node
// npm run i18n:sync [-- --draft | --apply | --check] (#1313)
//
// Keeps every locale in src/i18n/locales in step with en.json:
//   (default)  write .i18n-todo/<locale>.json task files (missing strings,
//              strings whose English changed since the merge base) + summary.
//   --draft    also ask a locally installed `claude` or `codex` CLI to draft
//              translations into .i18n-todo/<locale>.draft.json.
//   --apply    merge drafts / filled-in task files into the locale JSON (en.json
//              key order), drop stale keys, validate, fail loudly on problems.
//   --check    exit 1 if any locale is missing, stale or changed-untranslated.
// Options: --base <ref> (default: merge-base of HEAD and origin/main),
//          --engine claude|codex, --model <name>, --locale <code> (repeatable).
//
// Thin wrapper: the diff/merge/validation logic lives in src/utils/i18nSync.ts
// (unit-tested), loaded here via Node's TypeScript type stripping.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// eslint-plugin-import parses imports with the JS parser and can't read TypeScript.
/* eslint-disable import/namespace */
import {
  buildTaskFile,
  detectLocale,
  extractJsonObject,
  hasWork,
  mergeCatalogue,
  parseSupportedLocales,
  requiredPluralCategories,
  planApply,
  pluralGuide,
  proposalsFrom,
  validateCatalogue,
  validateEntry,
} from '../src/utils/i18nSync.ts';
/* eslint-enable import/namespace */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES_DIR = 'src/i18n/locales';
const TODO_DIR = join(ROOT, '.i18n-todo');
const GLOSSARY = join(ROOT, 'docs/i18n/GLOSSARY.md');
/** The app's per-locale plural rules, once runtime CLDR support exists. */
const RUNTIME_PLURALS = join(ROOT, 'src/i18n/plurals.ts');
/** Strings per CLI call — keeps replies well inside output limits. */
const DRAFT_CHUNK = 120;

function parseArgs(argv) {
  const opts = { mode: 'todo', base: null, engine: null, model: null, locales: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--draft' || arg === '--apply' || arg === '--check') opts.mode = arg.slice(2);
    else if (arg === '--base') opts.base = argv[++i];
    else if (arg === '--engine') opts.engine = argv[++i];
    else if (arg === '--model') opts.model = argv[++i];
    else if (arg === '--locale') opts.locales.push(argv[++i]);
    else if (arg === '--help' || arg === '-h') {
      console.log(
        readFileSync(fileURLToPath(import.meta.url), 'utf8')
          .split('\n')
          .slice(1, 13)
          .join('\n'),
      );
      process.exit(0);
    } else fail(`Unknown option ${arg} (try --help)`);
  }
  return opts;
}

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

function git(args) {
  const res = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return res.status === 0 ? res.stdout : null;
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
// Same bytes Prettier produces for these files (2-space JSON + newline).
const writeJson = (path, data) => writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);

/** JSON file at a commit, or null if it didn't exist there. */
function jsonAt(ref, path) {
  if (!ref) return null;
  const text = git(['show', `${ref}:${path}`]);
  return text === null ? null : JSON.parse(text);
}

function resolveBase(explicit) {
  if (explicit) {
    const sha = git(['rev-parse', '--verify', `${explicit}^{commit}`]);
    if (!sha) fail(`--base ${explicit} is not a commit`);
    return sha.trim();
  }
  for (const ref of ['origin/main', 'main']) {
    const sha = git(['merge-base', 'HEAD', ref]);
    if (sha) return sha.trim();
  }
  console.warn('⚠ No merge base with origin/main — changed-English detection is off.');
  return null;
}

/**
 * The plural rule table the APP uses (`CARDINAL_RULES`), so the tool demands
 * exactly the forms the runtime will pick — or null while the runtime still
 * uses i18n-js's English default for every locale.
 */
async function loadRuntimePluralRules() {
  if (!existsSync(RUNTIME_PLURALS)) return null;
  const mod = await import(pathToFileURL(RUNTIME_PLURALS).href);
  if (!mod.CARDINAL_RULES) fail('src/i18n/plurals.ts no longer exports CARDINAL_RULES');
  return mod.CARDINAL_RULES;
}

function loadState(opts, rules) {
  const en = readJson(join(ROOT, LOCALES_DIR, 'en.json'));
  const supported = parseSupportedLocales(readFileSync(join(ROOT, 'src/i18n/index.ts'), 'utf8'));
  const unknown = opts.locales.filter((l) => !supported.includes(l));
  if (unknown.length) fail(`Not in SUPPORTED_LOCALES: ${unknown.join(', ')}`);
  const locales = (opts.locales.length ? opts.locales : supported).filter((l) => l !== 'en');
  const base = resolveBase(opts.base);
  const baseEn = jsonAt(base, `${LOCALES_DIR}/en.json`);
  const diffs = locales.map((locale) => {
    const file = join(ROOT, LOCALES_DIR, `${locale}.json`);
    return detectLocale({
      locale,
      en,
      baseEn,
      localeTree: existsSync(file) ? readJson(file) : {},
      baseLocaleTree: jsonAt(base, `${LOCALES_DIR}/${locale}.json`),
      categories: requiredPluralCategories(locale, rules),
    });
  });
  return { en, base, diffs, rules };
}

function printSummary(diffs, base) {
  console.log(`\nLocale sync vs en.json${base ? ` (changes since ${base.slice(0, 8)})` : ''}\n`);
  const rows = diffs.map((d) => [d.locale, d.missing.length, d.changed.length, d.stale.length]);
  const header = ['locale', 'missing', 'changed', 'stale'];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cells) =>
    cells
      .map((c, i) => String(c).padEnd(widths[i]))
      .join('  ')
      .trimEnd();
  console.log(line(header));
  console.log(line(widths.map((w) => '-'.repeat(w))));
  for (const row of rows) console.log(line(row));
  console.log('');
}

function writeTodos(diffs, base) {
  mkdirSync(TODO_DIR, { recursive: true });
  for (const diff of diffs) {
    const file = join(TODO_DIR, `${diff.locale}.json`);
    // Carry over translations already filled in by hand.
    const previous = existsSync(file) ? readJson(file) : undefined;
    if (hasWork(diff)) writeJson(file, buildTaskFile(diff, base, previous));
    else rmSync(file, { force: true });
  }
}

// ---- --draft -------------------------------------------------------------

function onPath(cmd) {
  return spawnSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }).status === 0;
}

function pickEngine(requested) {
  if (requested) {
    if (!['claude', 'codex'].includes(requested)) fail('--engine must be claude or codex');
    return onPath(requested) ? requested : null;
  }
  return ['claude', 'codex'].find(onPath) ?? null;
}

function languageName(locale) {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(locale) ?? locale;
  } catch {
    return locale;
  }
}

function draftPrompt(locale, glossary, entries, rules) {
  const items = {};
  for (const [path, entry] of Object.entries(entries)) {
    const category = path.match(/\.(zero|one|two|few|many|other)$/)?.[1];
    items[path] = {
      en: entry.en,
      ...(entry.previousEn ? { previousEn: entry.previousEn } : {}),
      ...(entry.previous ? { previousTranslation: entry.previous } : {}),
      ...(category ? { pluralCategory: category } : {}),
    };
  }
  return [
    `Translate these Lightning Piggy app UI strings from English into ${languageName(locale)} (locale "${locale}").`,
    'Follow the translation rules below exactly.',
    `- Keys ending in a plural category (zero/one/few/many/other) are forms of a count-based string. The app picks them by count like this: ${pluralGuide(locale, rules)}. Write each form to read correctly for exactly those counts.`,
    '- If "previousEn" is present, the English was reworded: translate the NEW "en" text, reusing wording from "previousTranslation" where it still fits.',
    '- Keep every {{placeholder}} and %{placeholder} exactly as written.',
    'Reply with ONLY a JSON object mapping each key to its translated string — no prose, no code fence.',
    '',
    '## Translation rules',
    glossary,
    '',
    '## Strings',
    JSON.stringify(items, null, 2),
  ].join('\n');
}

function runEngine(engine, model, prompt) {
  if (engine === 'claude') {
    const args = ['-p', '--output-format', 'text', '--tools', ''];
    if (model) args.push('--model', model);
    return spawnSync('claude', args, {
      input: prompt,
      encoding: 'utf8',
      timeout: 15 * 60_000,
      maxBuffer: 64 * 1024 * 1024,
    });
  }
  const out = join(TODO_DIR, `.codex-reply-${process.pid}.txt`);
  const args = ['exec', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only', '-o', out];
  if (model) args.push('-m', model);
  args.push('-');
  const res = spawnSync('codex', args, {
    input: prompt,
    encoding: 'utf8',
    timeout: 15 * 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const stdout = existsSync(out) ? readFileSync(out, 'utf8') : '';
  rmSync(out, { force: true });
  return { ...res, stdout };
}

function draft(state, opts) {
  const engine = pickEngine(opts.engine);
  if (!engine) {
    console.log(
      `No ${opts.engine ?? '`claude` or `codex`'} CLI on PATH — skipping drafts. ` +
        'Fill in "translation" in the .i18n-todo/<locale>.json task files instead, then run --apply.',
    );
    return;
  }
  const glossary = readFileSync(GLOSSARY, 'utf8');
  for (const diff of state.diffs) {
    const taskPath = join(TODO_DIR, `${diff.locale}.json`);
    const task = readJson(taskPath);
    // Only draft what nobody has translated by hand yet.
    const paths = Object.keys(task.entries).filter((p) => !task.entries[p].translation.trim());
    if (!paths.length) continue;
    const rejected = [];
    const drafts = {};
    for (let i = 0; i < paths.length; i += DRAFT_CHUNK) {
      const chunk = Object.fromEntries(
        paths.slice(i, i + DRAFT_CHUNK).map((p) => [p, task.entries[p]]),
      );
      process.stdout.write(
        `${diff.locale}: drafting ${i + 1}-${i + Object.keys(chunk).length} of ${paths.length} with ${engine}… `,
      );
      const res = runEngine(
        engine,
        opts.model,
        draftPrompt(diff.locale, glossary, chunk, state.rules),
      );
      let reply;
      try {
        if (res.status !== 0)
          throw new Error(res.stderr?.trim().split('\n').pop() || `exit ${res.status}`);
        reply = extractJsonObject(res.stdout);
      } catch (err) {
        console.log(`failed (${err.message})`);
        continue;
      }
      let ok = 0;
      for (const [path, entry] of Object.entries(chunk)) {
        const value = reply[path];
        const problem =
          typeof value === 'string' ? validateEntry(path, value, entry.en) : `no draft for ${path}`;
        if (problem) rejected.push(problem);
        else {
          drafts[path] = { ...entry, translation: value };
          ok++;
        }
      }
      console.log(`${ok} ok`);
    }
    // Only the newly drafted entries, in the task file's shape (each stamped
    // with the English it was drafted from). Edit either file to review: a
    // translation in the task file always wins over the draft.
    writeJson(join(TODO_DIR, `${diff.locale}.draft.json`), { ...task, entries: drafts });
    const drafted = Object.keys(drafts).length;
    console.log(`→ .i18n-todo/${diff.locale}.draft.json (${drafted}/${paths.length} drafted)`);
    for (const problem of rejected) console.log(`  ⚠ ${problem}`);
  }
  console.log('\nReview the drafts, then run `npm run i18n:sync -- --apply`.');
}

// ---- --apply -------------------------------------------------------------

function apply(state) {
  let failed = false;
  for (const diff of state.diffs) {
    const { locale } = diff;
    const categories = requiredPluralCategories(locale, state.rules);
    const taskPath = join(TODO_DIR, `${locale}.json`);
    const draftPath = join(TODO_DIR, `${locale}.draft.json`);
    const fromTask = existsSync(taskPath) ? proposalsFrom(readJson(taskPath)) : {};
    const fromDraft = existsSync(draftPath) ? proposalsFrom(readJson(draftPath)) : {};
    // A reviewer's translation in the task file always beats the draft.
    for (const [path, { translation }] of Object.entries(fromTask)) {
      const drafted = fromDraft[path]?.translation;
      if (drafted !== undefined && drafted !== translation) {
        console.log(`  · ${locale} ${path}: using the task file's translation over the draft`);
      }
    }
    const plan = planApply(diff, { ...fromDraft, ...fromTask });

    const file = join(ROOT, LOCALES_DIR, `${locale}.json`);
    const before = existsSync(file) ? readFileSync(file, 'utf8') : '';
    const merged = mergeCatalogue(state.en, before ? JSON.parse(before) : {}, plan.accepted);
    const after = `${JSON.stringify(merged, null, 2)}\n`;
    const problems = [
      ...plan.rejected.map((p) => `rejected ${p}`),
      ...plan.unresolved.map((p) => `changed ${p}: English was reworded, no new translation`),
      ...validateCatalogue(state.en, merged, categories),
    ];
    for (const path of plan.skipped)
      console.log(`  · skipped ${path} (no longer needs translating)`);

    if (problems.length) {
      // Validate before writing: a failed apply leaves the catalogue untouched.
      failed = true;
      console.log(`${locale}: NOT written — ${problems.length} problem(s)`);
      for (const p of problems.slice(0, 40)) console.log(`  ✖ ${p}`);
      if (problems.length > 40) console.log(`  … and ${problems.length - 40} more`);
      continue;
    }
    // Nothing to merge or drop: leave the file alone rather than produce a
    // key-reorder-only diff.
    const touched = Object.keys(plan.accepted).length > 0 || diff.stale.length > 0;
    if (touched && after !== before) writeFileSync(file, after);
    console.log(
      `${locale}: ${touched && after !== before ? 'updated' : 'unchanged'} — ` +
        `${Object.keys(plan.accepted).length} applied, ${diff.stale.length} stale removed`,
    );
    // The to-do files are spent; re-applying them later could only confuse.
    rmSync(taskPath, { force: true });
    rmSync(draftPath, { force: true });
  }
  if (failed) fail('Locale validation failed — fix the entries above and re-run --apply.');
  console.log('\n✔ All locales valid.');
}

// ---- main ----------------------------------------------------------------

const opts = parseArgs(process.argv.slice(2));
const state = loadState(opts, await loadRuntimePluralRules());

if (opts.mode === 'apply') {
  apply(state);
} else {
  printSummary(state.diffs, state.base);
  if (opts.mode === 'check') {
    const dirty = state.diffs.filter(hasWork);
    if (dirty.length) {
      for (const d of dirty) {
        for (const e of [...d.missing, ...d.changed])
          console.log(`  ${d.locale}  ${e.reason.padEnd(7)}  ${e.path}`);
        for (const p of d.stale) console.log(`  ${d.locale}  stale    ${p}`);
      }
      fail(
        `Translations out of date in: ${dirty.map((d) => d.locale).join(', ')}. Run \`npm run i18n:sync\`.`,
      );
    }
    console.log('✔ Every locale is in sync with en.json.');
  } else {
    writeTodos(state.diffs, state.base);
    const work = state.diffs.filter(hasWork);
    if (!work.length) console.log('✔ Nothing to translate.');
    else {
      console.log(`Task files: ${work.map((d) => `.i18n-todo/${d.locale}.json`).join(', ')}`);
      if (opts.mode === 'draft') draft(state, opts);
      else
        console.log(
          'Fill in "translation" (or run with --draft), then `npm run i18n:sync -- --apply`.',
        );
    }
  }
}
