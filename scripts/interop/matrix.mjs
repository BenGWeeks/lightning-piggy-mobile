// Build the interop matrix (markdown) from one run's output folder:
//   node scripts/interop/matrix.mjs <out dir> <tag>
// Reads Maestro logs (logs/flow-*.log, `IO-CHECK <key>` labels with
// COMPLETED / WARNED / FAILED), the sender's JSON-lines logs and the
// screenshots folder. Pure file parsing — safe to re-run on an old folder.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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

/** Labelled IO-CHECK results from Maestro's --debug-output commands JSON. */
function checksFor(flow) {
  const root = join(logs, `maestro-${flow}`);
  if (!existsSync(root)) return null;
  const files = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.startsWith('commands-') && f.endsWith('.json')) files.push(p);
    }
  };
  walk(root);
  const results = [];
  let firstFailure = null;
  for (const f of files) {
    for (const entry of JSON.parse(readFileSync(f, 'utf8'))) {
      const cmd = Object.values(entry.command ?? {})[0];
      const label = typeof cmd === 'object' && cmd ? cmd.label : undefined;
      if (!firstFailure && entry.metadata?.status === 'FAILED') {
        const step = Object.keys(entry.command ?? {})[0] ?? 'step';
        firstFailure = `${step}: ${entry.metadata?.error?.message ?? 'failed'}`.slice(0, 200);
      }
      if (label?.startsWith('IO-CHECK ')) {
        results.push({
          key: label.slice(9),
          status: entry.metadata?.status ?? 'UNKNOWN',
          at: entry.metadata?.timestamp ?? 0,
        });
      }
    }
  }
  results.sort((a, b) => a.at - b.at);
  return Object.assign(results, { firstFailure });
}

// Checks that need Lightning Piggy's own sends (flow-147) can't be judged if
// that flow never got going.
const sendFlow = checksFor('flow-147-interop-lp-sends-group');
const lpSendsMissing = Boolean(sendFlow?.firstFailure);
const DEPENDS_ON_147 = /^lp\.(plain|md|long|edit|image|delete)$/;
// …and the rename-path checks need flow-149's rename to have happened.
const renameFlow = checksFor('flow-149-interop-lp-rename-after-admin');
const lpRenameMissing = Boolean(renameFlow?.firstFailure);
const DEPENDS_ON_149 = /^lp\.(after-lp-rename|renamed-title)$/;

for (const [file, title, shotPrefix] of FLOWS) {
  const checks = checksFor(file);
  const text = read(`${file}.log`);
  if (!checks && !text) continue;
  out.push(`## ${title}`, '');
  if (!checks?.length) {
    const why = checks?.firstFailure
      ? `it failed before its first check at \`${checks.firstFailure}\``
      : /UNAVAILABLE|127\.0\.0\.1:7001/.test(text)
        ? "Maestro's on-device driver dropped (harness, not the app)"
        : 'it stopped before its first check';
    out.push(`**HARNESS: no results** — ${why}. See \`logs/${file}.log\`.`, '');
    continue;
  }
  const rows = checks.map(({ key: label, status }) => {
    const key = label.replace(/^(dm|lp|lp-side)\./, '');
    const want = `${shotPrefix}${key.replace(/\./g, '-')}.png`;
    const shot = shots.find((s) => s === want);
    const result =
      lpSendsMissing && DEPENDS_ON_147.test(label)
        ? 'N/T (flow-147 failed)'
        : lpRenameMissing && DEPENDS_ON_149.test(label)
          ? 'N/T (flow-149 failed)'
          : (STATUS[status] ?? status);
    return `| ${result} | \`${label}\` | ${expectFor[key] ?? ''} | ${shot ? `screenshots/${shot}` : ''} |`;
  });
  out.push('| Result | Check | Expected | Screenshot |', '|---|---|---|---|', ...rows, '');
}

// Wire check: did the scripted member receive Lightning Piggy's sends?
const done = jsonLines('listen-lp.jsonl').find((l) => l.done);
if (done) {
  out.push('## Lightning Piggy → group, on the wire (scripted member)', '');
  if (lpSendsMissing)
    out.push(`N/T: flow-147 (Lightning Piggy's sends) failed at \`${sendFlow.firstFailure}\`.`, '');
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
