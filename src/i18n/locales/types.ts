// The shape every locale JSON file must match. `Translations` is derived from
// the English catalogue (`en.json`) — the source of truth for keys — with every
// leaf value mapped to `string`. `src/i18n/index.ts` then does
// `const es: Translations = esJson`, so a Spanish (or any other) catalogue that
// is missing a key en.json has — or misspells one — is a TypeScript error.
// That keeps the catalogues honest without a hand-maintained key list.
import en from './en.json';

type Stringify<T> = {
  [K in keyof T]: T[K] extends object ? Stringify<T[K]> : string;
};

export type Translations = Stringify<typeof en>;
