/** @jest-environment node */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const builder = path.join(__dirname, 'build-release-note.mjs');
let repo: string;
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'release-note-input-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.name', 'Offline Test');
  git('config', 'user.email', 'offline@example.invalid');
  git('commit', '--allow-empty', '-qm', 'fix: History fallback');
  git('tag', 'v1.0.0');
});
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

const announce = (notes?: string) => {
  const args = [builder, '--tag', 'v1.0.0', '--repo-dir', repo, '--event'];
  if (notes !== undefined) {
    const file = path.join(repo, 'notes.md');
    fs.writeFileSync(file, notes);
    args.push('--notes-file', file);
  }
  return JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8' })).content;
};

test.each(['Bug fixes and improvements.\n', 'A prose-only release summary.\n'])(
  'preserves explicitly supplied notes: %s',
  (notes) => {
    const content = announce(notes);
    expect(content).toContain(notes.trim());
    expect(content).not.toContain('History fallback');
  },
);

test.each([undefined, '', '  \n<!-- instructions\n- hidden\n-->\n'])(
  'falls back to tagged history when notes have no visible content: %s',
  (notes) => {
    expect(announce(notes)).toContain('• History fallback');
  },
);
