// End-to-end tests for scripts/i18n-sync.mjs --draft (#1313): runs the real
// CLI against a throwaway catalogue (I18N_SYNC_ROOT) with a fake `claude` on
// PATH, so drafting is deterministic and offline.
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const REPO = path.resolve(__dirname, '../..');
const SCRIPT = path.join(REPO, 'scripts/i18n-sync.mjs');

const en = { tabs: { wallets: 'Wallets', friends: 'Friends' }, greet: 'Hello, {{name}}!' };
const es = { tabs: { wallets: 'Carteras', friends: 'Amigos' }, greet: '¡Hola, {{name}}!' };

// Fake drafting CLI: answers "<LOCALE-HINT> <English>" for every key in the
// prompt's "## Strings" block, or fails when FAKE_DRAFT_FAIL=1.
const FAKE_CLAUDE = `#!/usr/bin/env node
if (process.env.FAKE_DRAFT_FAIL === '1') { console.error('rate limited'); process.exit(1); }
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  const items = JSON.parse(input.slice(input.indexOf('## Strings') + '## Strings'.length));
  const out = {};
  for (const [key, item] of Object.entries(items)) out[key] = 'DRAFT ' + item.en;
  process.stdout.write(JSON.stringify(out));
});
`;

let root: string;
let bin: string;

function writeJson(rel: string, data: unknown) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}
const readJson = (rel: string) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));

function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--disable-warning=ExperimentalWarning',
      '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
      SCRIPT,
      ...args,
    ],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        I18N_SYNC_ROOT: root,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        ...env,
      },
    },
  );
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-sync-'));
  bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'claude'), FAKE_CLAUDE, { mode: 0o755 });
  fs.mkdirSync(path.join(root, 'src/i18n'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'src/i18n/index.ts'),
    "export const SUPPORTED_LOCALES = ['en', 'es', 'uk'] as const;\n",
  );
  fs.mkdirSync(path.join(root, 'docs/i18n'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/i18n/GLOSSARY.md'), '# Rules\n');
  writeJson('src/i18n/locales/en.json', en);
  writeJson('src/i18n/locales/es.json', es); // clean
  writeJson('src/i18n/locales/uk.json', { tabs: { wallets: 'Гаманці' } }); // needs work
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('i18n-sync --draft', () => {
  it('drafts the dirty locale when another locale is already clean (no ENOENT)', () => {
    const res = run(['--draft', '--engine', 'claude']);
    expect(res.stderr).not.toMatch(/ENOENT/);
    expect(res.status).toBe(0);
    expect(fs.existsSync(path.join(root, '.i18n-todo/es.json'))).toBe(false);
    expect(readJson('.i18n-todo/uk.draft.json').entries).toEqual({
      'tabs.friends': { reason: 'missing', en: 'Friends', translation: 'DRAFT Friends' },
      greet: { reason: 'missing', en: 'Hello, {{name}}!', translation: 'DRAFT Hello, {{name}}!' },
    });
  });

  it('keeps a reviewer’s corrections to the draft when --draft is re-run', () => {
    expect(run(['--draft', '--engine', 'claude']).status).toBe(0);
    const draft = readJson('.i18n-todo/uk.draft.json');
    draft.entries['tabs.friends'].translation = 'Друзі';
    writeJson('.i18n-todo/uk.draft.json', draft);

    expect(run(['--draft', '--engine', 'claude']).status).toBe(0);
    expect(readJson('.i18n-todo/uk.draft.json').entries['tabs.friends'].translation).toBe('Друзі');
  });

  it('keeps earlier drafts when a retry fails', () => {
    expect(run(['--draft', '--engine', 'claude']).status).toBe(0);
    const before = readJson('.i18n-todo/uk.draft.json');
    // New English string → one key left to draft; the CLI then fails.
    writeJson('src/i18n/locales/en.json', { ...en, bye: 'Goodbye' });
    const res = run(['--draft', '--engine', 'claude'], { FAKE_DRAFT_FAIL: '1' });
    expect(res.stdout).toMatch(/failed \(rate limited\)/);
    expect(readJson('.i18n-todo/uk.draft.json').entries).toEqual(before.entries);
  });

  it('applies the reviewed draft, with the task file winning where both are filled', () => {
    expect(run(['--draft', '--engine', 'claude']).status).toBe(0);
    const task = readJson('.i18n-todo/uk.json');
    task.entries.greet.translation = 'Привіт, {{name}}!';
    writeJson('.i18n-todo/uk.json', task);
    const res = run(['--apply', '--locale', 'uk']);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/using the task file's translation over the draft/);
    expect(readJson('src/i18n/locales/uk.json')).toEqual({
      tabs: { wallets: 'Гаманці', friends: 'DRAFT Friends' },
      greet: 'Привіт, {{name}}!',
    });
  });
});
