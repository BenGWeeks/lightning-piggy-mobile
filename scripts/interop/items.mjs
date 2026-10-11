// The interop item set: every message type the scripted sender sends, with a
// per-run marker so a check can never pass on a bubble left over from an
// earlier run. Pure data + text builders — no network. Shared by
// marmot-sender.mjs (what to send) and run.sh (what the matrix expects).
//
// A marker is `IO<tag> <key>`, e.g. `IOk3f9 zh`. Maestro flows assert on the
// same strings via `${TAG}`, so keep marker text ASCII and regex-safe.

// An already-expired 21-sat test invoice (issued 2026-10-10, 1 h expiry) from
// a test Piggy wallet. Never payable — the suite must never move money.
export const EXPIRED_TEST_INVOICE =
  'lnbc210n1p4v5s6wpp5204hf8ceh9cjqcthh0vgfc7txh7zpwslm5p7cj3dykjwyuf3exxqhp59g6rd0hsjj8dp6upp0vd9g74na2qlvgnldn46c4jzl4en5sddcwqcqzzsxqrrsssp55s8v8zx6qewjgz6lqzh4uvw502tec85x7rd9v5u6l3k3ad0hzx6q9qxpqysgq9jhdj64ek390t580tgm5dlek3l9ytdv4cymkseupaqdrxag69jxjgdjj9pth9p39ynhk9hj34k52lrr8nkcuyn5a5tmy5kr3w6gd78cq5svuc3';

/** The text-set bodies (after the marker). Mirrors the manual 2026-10-11 run. */
export const TEXT_SET = {
  plain: 'TEST — please ignore. Plain text from the interop sender.',
  zh: '你好，小猪！今天存了多少钱？',
  emoji: '👨‍👩‍👧‍👦 👍🏽 🇬🇧 🐷⚡',
  md: '**bold** _italic_ ~~strike~~ `inline code`\n# Heading\n- item one\n> a quote',
  json: '{\n  "name": "Piggy",\n  "sats": 21,\n  "nested": { "ok": true }\n}',
  js: 'const greet = (n) => `hi ${n}`;\nif (a < b && c > d) { alert(1); }',
  html: '<b>bold</b> <script>alert(1)</script> <img src=x onerror=alert(1)> &amp; &lt;tag&gt;',
  long: Array.from({ length: 30 }, (_, i) => `Piggy saving sentence ${i + 1}.`).join(' '),
  word: `p${'i'.repeat(300)}g`,
  zw: 'p​i‍g﻿g⁠y | rtl: ‮evil‬ | zalgo: Z̷͖a̸l͓g̵o',
};

export const marker = (tag, key) => `IO${tag} ${key}`;

/** A geo message in the exact shape Lightning Piggy sends (locationService.formatGeoMessage). */
export function locationText(tag) {
  const lat = '51.50740';
  const lon = '-0.12780';
  return (
    `${marker(tag, 'location')}\n\u{1F4CD} Shared location\ngeo:${lat},${lon};u=5\n` +
    `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`
  );
}

/** A contact card in the exact shape Lightning Piggy sends (useComposerActions). */
export const contactText = (tag, label, nprofile) =>
  `${marker(tag, 'contact')} Shared contact: ${label}\nnostr:${nprofile}`;

/**
 * Every item the sender produces, in send order. `kind` is the Marmot rumor
 * kind; `ref` names an earlier item it points at (reply / reaction / edit /
 * delete). `expect` describes what a receiver should show — run.sh copies it
 * into the matrix.
 */
export function itemPlan(tag) {
  const text = Object.entries(TEXT_SET).map(([key, body]) => ({
    key: `text.${key}`,
    kind: 9,
    content: `${marker(tag, key)}: ${body}`,
    expect: `text "${marker(tag, key)}" exact`,
  }));
  return [
    ...text,
    {
      key: 'reply',
      kind: 9,
      ref: 'text.plain',
      content: `${marker(tag, 'reply')}: replying to plain`,
      expect: 'reply bubble quoting the plain message',
    },
    { key: 'react', kind: 7, ref: 'text.zh', content: '❤️', expect: '❤️ on the zh message' },
    { key: 'react2', kind: 7, ref: 'text.emoji', content: '👍', expect: '👍 then removed' },
    { key: 'unreact', kind: 5, ref: 'react2', content: '', expect: '👍 gone from emoji message' },
    {
      key: 'edit.target',
      kind: 9,
      content: `${marker(tag, 'editme')} v1`,
      expect: 'replaced by v2 (see edit)',
    },
    {
      key: 'edit',
      kind: 1009,
      ref: 'edit.target',
      content: `${marker(tag, 'editme')} v2 edited`,
      expect: `"${marker(tag, 'editme')} v2 edited" + edited label`,
    },
    {
      key: 'delete.target',
      kind: 9,
      content: `${marker(tag, 'deleteme')} should disappear`,
      expect: 'gone (see delete)',
    },
    {
      key: 'delete',
      kind: 5,
      ref: 'delete.target',
      content: '',
      expect: `"${marker(tag, 'deleteme')}" not shown`,
    },
    { key: 'image', kind: 9, media: 'image', content: '', expect: 'image bubble' },
    { key: 'voice', kind: 9, media: 'voice', content: '', expect: 'voice-note player' },
    {
      key: 'invoice',
      kind: 9,
      content: `${marker(tag, 'invoice')} ${EXPIRED_TEST_INVOICE}`,
      expect: 'invoice card (21 sats, expired)',
    },
    { key: 'location', kind: 9, content: locationText(tag), expect: 'location card' },
    { key: 'contact', kind: 9, content: null, expect: 'contact card' },
  ];
}
