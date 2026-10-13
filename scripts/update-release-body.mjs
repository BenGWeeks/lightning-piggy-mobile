#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export function replaceSection(body, section, content) {
  if (!['generated-notes', 'nostr-link'].includes(section)) {
    throw new Error('Unknown release body section.');
  }
  const start = `<!-- ${section} -->`;
  const end = `<!-- /${section} -->`;
  const block = `${start}\n${content.trim()}\n${end}`;
  const from = body.indexOf(start);
  if (from === -1) return `${body}${body.endsWith('\n\n') ? '' : '\n\n'}${block}\n`;
  const to = body.indexOf(end, from + start.length);
  // Never guess the boundary and accidentally consume human notes or another block.
  if (to === -1) throw new Error(`Unclosed release body section: ${section}`);
  return body.slice(0, from) + block + body.slice(to + end.length);
}

function main() {
  const { values } = parseArgs({
    options: {
      tag: { type: 'string' },
      section: { type: 'string' },
      'content-file': { type: 'string' },
    },
  });
  const content = fs.readFileSync(values['content-file'], 'utf8');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'release-body-'));
  try {
    // Both workflow jobs share a concurrency lock. Re-read after preparing content,
    // immediately before writing, so earlier human/automation edits are preserved.
    const body = execFileSync(
      'gh',
      ['release', 'view', values.tag, '--json', 'body', '--jq', '.body'],
      {
        encoding: 'utf8',
      },
    ).replace(/\n$/, ''); // gh adds a newline to its output.
    const updated = replaceSection(body, values.section, content);
    if (updated === body) return;
    const file = path.join(temp, 'body.md');
    fs.writeFileSync(file, updated);
    execFileSync('gh', ['release', 'edit', values.tag, '--notes-file', file], { stdio: 'inherit' });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
