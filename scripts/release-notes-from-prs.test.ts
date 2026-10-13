/** @jest-environment node */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const generator = path.join(__dirname, 'release-notes-from-prs.sh');
let repo: string;
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

test('includes shipped PRs merged after tag commit time, with date-filtering CLI', () => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-notes-dates-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-q');
  git('config', 'user.name', 'Offline Test');
  git('config', 'user.email', 'offline@example.invalid');
  const commit = (date: string) => {
    execFileSync('git', ['commit', '--allow-empty', '-qm', 'fixture'], {
      cwd: repo,
      env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    });
    return git('rev-parse', 'HEAD');
  };
  const old = commit('2026-10-01T12:00:00Z');
  git('tag', '-am', 'Previous release', 'v1.0.0');
  const shipped = commit('2026-10-02T12:00:00Z');
  git('tag', 'v1.0.1');
  const future = commit('2026-10-04T12:00:00Z');
  const prs = [
    { number: 1, title: 'feat: old feature', mergedAt: '2026-10-01T13:00:00Z', oid: old },
    { number: 2, title: 'fix: shipped fix', mergedAt: '2026-10-03T12:00:00Z', oid: shipped },
    { number: 3, title: 'fix: future fix', mergedAt: '2026-10-04T13:00:00Z', oid: future },
  ].map(({ oid, ...pr }) => ({ ...pr, mergeCommit: { oid } }));
  fs.writeFileSync(path.join(repo, 'prs.json'), JSON.stringify(prs));
  // Apply the same merged:since..until search that the original script used.
  // Omitting --search returns all candidates; ancestry must select the range.
  fs.writeFileSync(
    path.join(repo, 'gh'),
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const searchIndex = args.indexOf('--search');
let prs = JSON.parse(fs.readFileSync('prs.json', 'utf8'));
if (searchIndex !== -1) {
  const match = /^merged:(.+)\\.\\.(.+)$/.exec(args[searchIndex + 1]);
  if (!match) process.exit(2);
  prs = prs.filter(pr => Date.parse(pr.mergedAt) >= Date.parse(match[1]) &&
    Date.parse(pr.mergedAt) <= Date.parse(match[2]));
}
process.stdout.write(JSON.stringify(prs));
`,
    { mode: 0o755 },
  );
  const options = {
    cwd: repo,
    env: { ...process.env, PATH: `${repo}:${process.env.PATH}` },
    encoding: 'utf8' as const,
  };
  // Prove the fake CLI really excludes the shipped PR under the old bounds.
  const dated = JSON.parse(
    execFileSync(
      'gh',
      ['pr', 'list', '--search', 'merged:2026-10-01T12:00:00Z..2026-10-02T12:00:00Z'],
      options,
    ),
  );
  expect(dated.map((pr: { number: number }) => pr.number)).toEqual([1]);
  expect(execFileSync(generator, ['v1.0.0', 'v1.0.1'], options)).toBe(
    '### Fixed\n\n- Shipped fix (#2)\n',
  );
  expect(execFileSync(generator, ['', 'v1.0.1'], options)).toContain('Old feature (#1)');
  expect(execFileSync(generator, ['v1.0.1', 'v1.0.1'], options)).toBe(
    'Bug fixes and improvements.\n',
  );
});

test('skips an unavailable post-checkout merge SHA and keeps shipped notes', () => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-notes-missing-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-q');
  git('config', 'user.name', 'Offline Test');
  git('config', 'user.email', 'offline@example.invalid');
  git('commit', '--allow-empty', '-qm', 'fixture');
  git('tag', 'v1.0.0');
  git('commit', '--allow-empty', '-qm', 'shipped');
  git('tag', 'v1.0.1');
  const shipped = git('rev-parse', 'HEAD');
  const unavailable = 'f'.repeat(40);
  expect(() => git('cat-file', '-e', `${unavailable}^{commit}`)).toThrow();
  fs.writeFileSync(
    path.join(repo, 'prs.json'),
    JSON.stringify([
      { number: 2, title: 'fix: future fix', mergeCommit: { oid: unavailable } },
      { number: 1, title: 'fix: shipped fix', mergeCommit: { oid: shipped } },
    ]),
  );
  fs.writeFileSync(path.join(repo, 'gh'), '#!/bin/sh\ncat prs.json\n', { mode: 0o755 });
  expect(
    execFileSync(generator, ['v1.0.0', 'v1.0.1'], {
      cwd: repo,
      env: { ...process.env, PATH: `${repo}:${process.env.PATH}` },
      encoding: 'utf8',
    }),
  ).toBe('### Fixed\n\n- Shipped fix (#1)\n');
});
