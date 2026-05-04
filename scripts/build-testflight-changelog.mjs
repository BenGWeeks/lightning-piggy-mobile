#!/usr/bin/env node
// Assemble the TestFlight "What to Test" string for the current release.
//
// Source priority:
//   1. docs/RELEASE_NOTES_NEXT.md — bullets contributors appended in their PRs.
//   2. Fallback: `git log <previous-tag>..HEAD --oneline` subjects, filtered
//      to user-visible types (feat / fix / perf), prefix-stripped.
//
// Output: prints the assembled changelog to stdout. The release workflow
// captures stdout and forwards it to scripts/asc-set-whats-new.mjs.
//
// TestFlight caps "What to Test" at 4000 chars. We truncate at 3900 to leave
// headroom for any trailing "...and more" hint.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO_ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const NOTES_FILE = path.join(REPO_ROOT, 'docs', 'RELEASE_NOTES_NEXT.md');
const MAX_CHARS = 3900;

function readBulletsFromNotesFile() {
  if (!fs.existsSync(NOTES_FILE)) return [];
  const raw = fs.readFileSync(NOTES_FILE, 'utf8');
  // Strip HTML comments (the contributor-instruction block at the top).
  const noComments = raw.replace(/<!--[\s\S]*?-->/g, '');
  const bullets = [];
  for (const line of noComments.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) continue;
    // Markdown bullet: `- foo` or `* foo`. Drop the marker.
    const m = trimmed.match(/^[-*]\s+(.*)$/);
    if (!m) continue;
    const body = m[1].trim();
    if (!body) continue;
    bullets.push(body);
  }
  return dedupe(bullets);
}

function readBulletsFromGitLog() {
  // Find the previous tag (the one before HEAD). If no tags exist yet, fall
  // back to the last 50 commits — first release will have no prior tag.
  let range;
  try {
    const prev = execFileSync('git', ['describe', '--tags', '--abbrev=0', 'HEAD^'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (prev) range = `${prev}..HEAD`;
  } catch {
    // No prior tag — first release.
  }
  const args = ['log', '--pretty=format:%s'];
  if (range) args.push(range);
  else args.push('-50');
  const out = execFileSync('git', args, { encoding: 'utf8' });
  const bullets = [];
  for (const subject of out.split('\n')) {
    const trimmed = subject.trim();
    if (!trimmed) continue;
    // Conventional Commits: only surface user-visible types in fallback mode.
    const m = trimmed.match(/^(feat|fix|perf)(?:\([^)]+\))?!?:\s*(.+?)(?:\s*\(#\d+\))?$/i);
    if (!m) continue;
    const cleaned = m[2].trim();
    if (!cleaned) continue;
    bullets.push(cleaned);
  }
  return dedupe(bullets);
}

function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function format(bullets) {
  if (bullets.length === 0) return '';
  const lines = bullets.map((b) => `- ${b}`);
  let joined = lines.join('\n');
  if (joined.length <= MAX_CHARS) return joined;
  // Truncate by dropping bullets from the tail until we fit, then append a hint.
  while (lines.length > 1 && lines.join('\n').length + '\n- ...and more'.length > MAX_CHARS) {
    lines.pop();
  }
  lines.push('- ...and more');
  return lines.join('\n');
}

function main() {
  let bullets = readBulletsFromNotesFile();
  let source = 'docs/RELEASE_NOTES_NEXT.md';
  if (bullets.length === 0) {
    bullets = readBulletsFromGitLog();
    source = 'git log fallback';
  }
  const output = format(bullets);
  if (!output) {
    // Last-resort default — better than blank in the App Store Connect UI.
    process.stdout.write('Bug fixes and improvements.\n');
    process.stderr.write('[build-testflight-changelog] no bullets found; using default\n');
    return;
  }
  process.stderr.write(`[build-testflight-changelog] ${bullets.length} bullets from ${source}\n`);
  process.stdout.write(output + '\n');
}

main();
