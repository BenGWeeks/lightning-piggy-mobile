// Pseudo-language `en-XA` (#1313): a dev/preview-only locale generated from
// en.json at runtime, never stored as a catalogue file. Every string comes
// out accented, ~40% longer and bracketed — "Wallets" → "[Ŵåļļéţš···]" — so
// on device:
//   - text that clipped or truncated loses its closing "]" or padding;
//   - text that is still plain English was never routed through `t()`.
// Placeholders, URLs and email addresses stay intact so interpolation and
// links keep working.

import type { I18n } from 'i18n-js';
import { createI18nInstance } from '../i18n';
import enJson from '../i18n/locales/en.json';
import { isProductionBuild } from './appEnvironment';

/** The standard pseudo-locale tag (Android's "English (XA)"). */
export const PSEUDO_LOCALE = 'en-XA';
export type PseudoLocale = typeof PSEUDO_LOCALE;

/** Picker label — dev-only, so plain English like the native-name labels. */
export const PSEUDO_LOCALE_LABEL = 'Pseudo (testing)';

/** Share of the source length added as padding. */
const EXPANSION = 0.4;
const PAD = '·';

const ACCENTS: Record<string, string> = {
  a: 'å', b: 'ƀ', c: 'ç', d: 'ð', e: 'é', f: 'ƒ', g: 'ĝ', h: 'ĥ', i: 'î',
  j: 'ĵ', k: 'ķ', l: 'ļ', m: 'ɱ', n: 'ñ', o: 'ö', p: 'þ', q: 'ǫ', r: 'ŕ',
  s: 'š', t: 'ţ', u: 'û', v: 'ṽ', w: 'ŵ', x: 'ẋ', y: 'ý', z: 'ž',
  A: 'Å', B: 'Ɓ', C: 'Ç', D: 'Ð', E: 'É', F: 'Ƒ', G: 'Ĝ', H: 'Ĥ', I: 'Î',
  J: 'Ĵ', K: 'Ķ', L: 'Ļ', M: 'Ṁ', N: 'Ñ', O: 'Ö', P: 'Þ', Q: 'Ǫ', R: 'Ŕ',
  S: 'Š', T: 'Ţ', U: 'Û', V: 'Ṽ', W: 'Ŵ', X: 'Ẋ', Y: 'Ý', Z: 'Ž',
}; // prettier-ignore

/** Spans copied verbatim: `{{x}}` / `%{x}` interpolations, URLs, emails. */
const PROTECTED = /\{\{[^}]*\}\}|%\{[^}]*\}|https?:\/\/[^\s)]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

/** Pseudo-localise one string. Deterministic; empty stays empty. */
export function pseudoLocalize(source: string): string {
  if (!source) return source;
  let out = '';
  let textLength = 0;
  let last = 0;
  const accent = (text: string) => {
    textLength += text.length;
    for (const ch of text) out += ACCENTS[ch] ?? ch;
  };
  for (const match of source.matchAll(PROTECTED)) {
    const index = match.index ?? 0;
    accent(source.slice(last, index));
    out += match[0];
    last = index + match[0].length;
  }
  accent(source.slice(last));
  return `[${out}${PAD.repeat(Math.ceil(textLength * EXPANSION))}]`;
}

type Tree = { [key: string]: string | Tree };

/** Pseudo-localise every leaf of a catalogue, keeping its shape. */
export function pseudoCatalogue<T extends Tree>(tree: T): T {
  const out: Tree = {};
  for (const [key, value] of Object.entries(tree)) {
    out[key] = typeof value === 'string' ? pseudoLocalize(value) : pseudoCatalogue(value);
  }
  return out as T;
}

/**
 * Offered in dev (Metro) and preview builds only — preview sets
 * `EXPO_PUBLIC_KEEP_PERF_LOGS=1` (eas.json) — and never in the production
 * binary, whatever its env.
 */
export function isPseudoLocaleAvailable(): boolean {
  const devOrPreview = __DEV__ || process.env.EXPO_PUBLIC_KEEP_PERF_LOGS === '1';
  return devOrPreview && !isProductionBuild();
}

let cached: Tree | null = null;

/** I18n instance rendering `en-XA`; the catalogue is built once, on first use. */
export function createPseudoI18nInstance(): I18n {
  cached ??= pseudoCatalogue(enJson as Tree);
  const instance = createI18nInstance('en');
  instance.store({ [PSEUDO_LOCALE]: cached });
  instance.locale = PSEUDO_LOCALE;
  return instance;
}
