import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const generator = fileURLToPath(new URL('./release-notes-from-prs.sh', import.meta.url));

test('group PR titles and enforce annotated tag boundaries using merge ancestry', (t) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-notes-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.name', 'Offline Test');
  git('config', 'user.email', 'offline@example.invalid');
  const commit = (subject) => {
    git('commit', '--allow-empty', '-qm', subject);
    return git('rev-parse', 'HEAD');
  };
  const old = commit('feat: Older');
  git('tag', '-am', 'Annotated previous tag', 'v1.0.0');
  const current = commit('release');
  git('tag', 'v1.0.1');
  const future = commit('fix: Future');
  const titles = [
    ['feat(wallet): add a wallet (#10, #11)', current],
    ['perf: speed up sync', current],
    ['refactor(core)!: simplify settings', current],
    ['fix: restore messages (#12)', current],
    ['chore(ci): update tooling', current],
    ['feat: old feature', old],
    ['fix: future fix', future],
    ['fix: removed historical commit', 'f'.repeat(40)],
  ];
  const prs = titles.map(([title, oid], index) => ({
    number: index + 100,
    title,
    mergedAt: '2026-10-13T12:00:00Z',
    mergeCommit: { oid },
  }));
  fs.writeFileSync(path.join(repo, 'prs.json'), JSON.stringify(prs));
  // Exact date bounds would omit these PRs; candidate selection uses ancestry.
  fs.writeFileSync(path.join(repo, 'gh'), '#!/bin/bash\ncat prs.json\n', { mode: 0o755 });
  const run = (from, to) =>
    execFileSync(generator, [from, to], {
      cwd: repo,
      env: { ...process.env, PATH: `${repo}:${process.env.PATH}` },
      encoding: 'utf8',
    });
  assert.equal(
    run('v1.0.0', 'v1.0.1'),
    '### New\n\n- Add a wallet (#100)\n\n### Improved\n\n- Speed up sync (#101)\n- Simplify settings (#102)\n\n### Fixed\n\n- Restore messages (#103)\n',
  );
  assert.equal(run('v1.0.1', 'v1.0.1'), 'Bug fixes and improvements.\n');
  assert.match(run('', 'v1.0.1'), /Old feature \(#105\)/);
});
