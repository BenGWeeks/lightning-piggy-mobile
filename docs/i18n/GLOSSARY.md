# Lightning Piggy translation rules

These rules apply to every locale in `src/i18n/locales/`. `en.json` is the source of truth; every other catalogue mirrors its keys. `npm run i18n:sync -- --draft` passes this file to the drafting CLI, so keep it accurate. Workflow: [Translation workflow](#translation-workflow) below.

## Product and tone

- Lightning Piggy is a **family app for smart savers**: a Bitcoin and Lightning wallet, plus secure messaging (Nostr / Marmot), a Market, and Explore (events and geo-caches).
- **Never describe it as a kids' app.** It's for the whole family.
- Tone: warm, clear, plain language for families. Keep UI labels short.
- Use the informal "you" where that's natural for a family app (see the per-language notes).
- **Never write "LP"** in user-facing text. The brand is always "Lightning Piggy".

## Never translate

Keep these brand and protocol names exactly as written: Lightning Piggy, Bitcoin, Lightning, Nostr, Marmot, White Noise, Amethyst, NIP-04, NIP-17 (and any NIP-nn), NIP-GC, NWC, Amber, Clave, Blossom, LNURL, Boltz, MLS, Electrum, CoinOS, GIPHY, OpenStreetMap, BTC Map, npub, nsec.

- **sats** stays "sats" (Latin script) unless a language has a well-established term. es and uk keep "sats".
- **Piggy** (the wallet) and **Piglet(s)** (a geo-cache stash published by the app) stay in English, as in es.json and uk.json. Be consistent within a file.

## Keep intact

- **Placeholders:** `{{name}}`, `{{count}}`, `{{amount}}` and the `%{count}` form must appear unchanged, every one of them. Move them to wherever the grammar needs them, but never translate, drop or rename them. `i18n:sync --apply` and the catalogue guard both reject a placeholder mismatch.
- `\n` line breaks, Markdown, emoji, URLs, email addresses and testID-like tokens stay exactly as written.
- Values are strings, or plural objects where en.json has them. Use the same JSON structure and keys as en.json: no missing keys and no extra keys, apart from the extra plural forms below.

## Plurals (CLDR)

Plural objects like `{ "one": "…", "other": "…" }` use CLDR cardinal categories, picked per locale at runtime.

| Locale                 | Categories to write           | Notes                                                                                                                                                                                       |
| ---------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| en, es, de, hu, hi, mr | `one`, `other`                |                                                                                                                                                                                             |
| pl, uk                 | `one`, `few`, `many`, `other` | Add `few` and `many` next to `one` and `other`. pl: 1 wiadomość (one), 2–4 wiadomości (few), 5+ wiadomości (many). uk: 1 повідомлення (one), 2–4 повідомлення (few), 5+ повідомлень (many). |
| zh-Hans                | `other`                       | Keep `one` too, with the same text as `other`, so key parity holds.                                                                                                                         |

- Keep any `zero` form en.json has (e.g. "Remove old devices"). It's used when the count is 0.
- `i18n:sync` lists any missing `few` / `many` forms as missing strings, sourced from en's `other` text.

## Length and precision

- Buttons, tabs and chips must stay short. If a literal translation is much longer than the English, find a shorter natural phrasing.
- Wording about keys, backups and payments must stay precise. **Never soften safety warnings** (e.g. "never share your key").
- Check long-running languages in the pseudo-language first: **Settings → Display & language → Pseudo (testing)**, available in dev and preview builds only. It pads every string by about 40% and brackets it (`[Ŵåļļéţš···]`). A missing `]` means the text clipped, and plain English means the string never went through `t()`.

## Per-language notes

- **Spanish (es):** informal **tú** ("Inténtalo de nuevo"). Neutral international Spanish.
- **Ukrainian (uk):** the polite plural imperative that's standard in Ukrainian UI ("Спробуйте ще раз"). Plurals: one / few / many / other.
- **German (de):** informal **du**, lowercase in running text. Prefer short compounds over long phrases for labels. Plurals: one / other.
- **Hungarian (hu):** informal **te**. Plurals: one / other (a noun after a number stays singular: "3 üzenet").
- **Polish (pl):** informal **ty**. Plurals: one / few / many / other.
- **Chinese, Simplified (zh-Hans):** concise, neutral register (你). Use full-width punctuation in Chinese text, but keep placeholders and Latin brand names as they are. Plurals: `other` (keep `one` identical).
- **Hindi (hi):** Devanagari script; respectful **आप** consistently. Plurals: one / other.
- **Marathi (mr):** Devanagari script; **तुम्ही** consistently. Plurals: one / other.
- **Hindi and Marathi tech terms:** warm, everyday language, avoiding heavily Sanskritised words. Prefer the terms Indian users see in payment and crypto apps (Paytm, PhonePe, GPay, Indian exchanges), which is often transliterated English: वॉलेट (wallet), इनवॉइस (invoice), रिले (relay), ग्रुप (group), चैट (chat), बैकअप (backup), QR कोड. Use a native word only where it's genuinely common (भेजें / पाठवा for Send, प्राप्त करें / मिळवा for Receive). Numbers stay as Western digits (0–9), and "sats" stays in Latin script.

## Translation workflow

```sh
npm run i18n:sync                # list what's missing / stale / changed; write .i18n-todo/<locale>.json
npm run i18n:sync -- --draft     # also draft translations with a local `claude` or `codex` CLI
npm run i18n:sync -- --apply     # merge drafts / filled task files, drop stale keys, validate
npm run i18n:sync -- --check     # exit 1 if any locale is out of date (pre-push)
```

- "Changed" means the English text of an existing key changed since `git merge-base HEAD origin/main`, while the translation didn't. Re-translate it, even though the key already exists.
- To translate by hand, fill in `"translation"` in `.i18n-todo/<locale>.json` and run `--apply`.
- Always review drafts before applying. A draft is a starting point, not a final translation.
- Options: `--locale <code>` (repeatable), `--engine claude|codex`, `--model <name>`, `--base <ref>`.
