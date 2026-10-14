#!/usr/bin/env node
// Regenerate src/data/countryNames.json — localised ISO 3166-1 country names
// for every non-English app locale, taken from CLDR via Node's bundled ICU
// (`Intl.DisplayNames`).
//
// Why a generated table instead of calling Intl.DisplayNames at runtime:
// Hermes (the app's JS engine on Android and iOS) doesn't implement
// Intl.DisplayNames, so the names have to ship as data. English keeps the
// hand-tuned names in src/data/countries.ts (shared with the checkout's
// country picker), so it isn't emitted here.
//
// Usage: node scripts/generate-country-names.mjs
// Re-run when a locale is added to src/i18n/locales or a code to countries.ts.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const countriesSource = readFileSync(join(root, 'src/data/countries.ts'), 'utf8');
const codes = [...countriesSource.matchAll(/\{ code: '([A-Z]{2})'/g)].map((m) => m[1]);
if (codes.length < 249) throw new Error(`expected 249 country codes, found ${codes.length}`);

const locales = readFileSync(join(root, 'src/i18n/index.ts'), 'utf8')
  .match(/SUPPORTED_LOCALES = \[([^\]]+)\]/)[1]
  .match(/'([^']+)'/g)
  .map((s) => s.slice(1, -1))
  .filter((locale) => locale !== 'en');

const table = {};
for (const locale of locales) {
  const names = new Intl.DisplayNames([locale], { type: 'region', fallback: 'none' });
  table[locale] = {};
  for (const code of codes) {
    const name = names.of(code);
    // Skip codes CLDR has no localised name for (the app falls back to English).
    if (name && name !== code) table[locale][code] = name;
  }
}

const out = join(root, 'src/data/countryNames.json');
writeFileSync(out, `${JSON.stringify(table, null, 2)}\n`);
console.log(
  `wrote ${out}: ${locales.length} locales × ${codes.length} codes (ICU ${process.versions.icu}, CLDR ${process.versions.cldr})`,
);
