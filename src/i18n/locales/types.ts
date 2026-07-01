// The shape every locale JSON file must match. Adding a key here without
// adding it to every locale file in src/i18n/index.ts's `en`/`es` (etc.)
// assignments is a TypeScript error — that's what keeps the catalogues
// honest as #137's translation batches land one surface at a time.
export interface Translations {
  tabs: {
    home: string;
    messages: string;
    explore: string;
    friends: string;
  };
}
