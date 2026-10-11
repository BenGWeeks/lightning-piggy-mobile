// Build the interop matrix (markdown) from one run's output folder:
//   node scripts/interop/matrix.mjs <out dir> <tag>
// Reads Maestro logs (logs/flow-*.log, `IO-CHECK <key>` labels with
// COMPLETED / WARNED / FAILED), the sender's JSON-lines logs and the
// screenshots folder. Pure file parsing — safe to re-run on an old folder.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { itemPlan } from './items.mjs';

const [dir, tag] = process.argv.slice(2);
if (!dir || !tag) {
  console.error('usage: matrix.mjs <out dir> <tag>');
  process.exit(2);
}
const logs = join(dir, 'logs');
const read = (f) => (existsSync(join(logs, f)) ? readFileSync(join(logs, f), 'utf8') : '');
const jsonLines = (f) =>
  read(f)
    .split('\n')
    .filter((l) => l.startsWith('{'))
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
const shots = existsSync(join(dir, 'screenshots')) ? readdirSync(join(dir, 'screenshots')) : [];

const FLOWS = [
  ['flow-145-interop-lp-receives-group', 'Sender → Lightning Piggy (group)', 'lp-group-'],
  ['flow-151-interop-lp-receives-dm', 'Sender → Lightning Piggy (Marmot 1:1)', 'lp-dm-'],
  ['flow-146-interop-wn-receives-group', 'Sender → White Noise (group)', 'wn-group-'],
  [
    'flow-148-interop-wn-receives-lp',
    'Lightning Piggy → White Noise (group, after changes)',
    'wn-lp-',
  ],
  [
    'flow-149-interop-lp-rename-after-admin',
    'Lightning Piggy after admin change / own rename',
    'lp-after-',
  ],
  ['flow-150-interop-lp-receives-after-rename', 'Lightning Piggy after its rename', 'lp-after-'],
];
const STATUS = { COMPLETED: 'PASS', WARNED: 'FAIL', FAILED: 'FAIL', SKIPPED: 'N/T' };
const expectFor = Object.fromEntries(itemPlan(tag).map((i) => [i.key, i.expect]));

const out = [];
out.push(`# Interop run \`${tag}\``, '');
out.push(
  `Folder: \`${dir}\`. PASS = the check's element was found (or, for "not shown" checks, absent).`,
  '',
);

// Sender side: what was actually sent.
const sent = [...jsonLines('send-group.jsonl'), ...jsonLines('send-dm.jsonl')];
const failedSends = sent.filter((s) => s.item && !s.ok);
out.push(
  `Scripted sender: ${sent.filter((s) => s.ok).length}/${sent.length} sends OK` +
    (failedSends.length
      ? ` — failed: ${failedSends.map((s) => `${s.item} (${s.error})`).join('; ')}`
      : ''),
  '',
);

for (const [file, title, shotPrefix] of FLOWS) {
  const text = read(`${file}.log`);
  if (!text) continue;
  const rows = [];
  const seen = new Set();
  for (const line of text.split('\n')) {
    const m = line.match(/IO-CHECK (\S+?)(?:\.\.\.|\s).*?(COMPLETED|WARNED|FAILED|SKIPPED)/);
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    const key = m[1].replace(/^(dm|lp|lp-side)\./, '');
    const shot = shots.find((s) => s.startsWith(shotPrefix) && s.includes(key.replace(/\./g, '-')));
    rows.push(
      `| ${STATUS[m[2]]} | \`${m[1]}\` | ${expectFor[key] ?? ''} | ${shot ? `screenshots/${shot}` : ''} |`,
    );
  }
  const crashed = /FAILED/.test(text) && !rows.length;
  out.push(`## ${title}`, '');
  if (crashed) out.push(`Flow failed before its checks — see \`logs/${file}.log\`.`, '');
  if (rows.length)
    out.push('| Result | Check | Expected | Screenshot |', '|---|---|---|---|', ...rows, '');
}

// Wire check: did the scripted member receive Lightning Piggy's sends?
const done = jsonLines('listen-lp.jsonl').find((l) => l.done);
if (done) {
  out.push('## Lightning Piggy → group, on the wire (scripted member)', '');
  for (const re of done.matched ?? []) out.push(`- PASS \`${re}\``);
  for (const re of done.missing ?? []) out.push(`- FAIL \`${re}\` not received in 90 s`);
  out.push('');
}
const info = jsonLines('group-info.json')[0];
if (info)
  out.push(
    `Group at the end: name \`${info.name}\`, epoch ${info.epoch}, ${info.members.length} members.`,
    '',
  );
console.log(out.join('\n'));
