# Contributing to Lightning Piggy

Thanks for helping make Lightning Piggy better! Lightning Piggy is a family Bitcoin Lightning wallet and
Nostr app for "smart savers" and their families. Bug reports, ideas, translations, docs and code are all
welcome.

By participating you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md). By contributing you agree
that your work is licensed under the [MIT License](LICENSE).

**Found a security problem?** Please do not open a public issue. See [SECURITY.md](SECURITY.md).

## Ways to contribute

- **Report a bug or suggest a feature** using the [issue forms](https://github.com/BenGWeeks/lightning-piggy-mobile/issues/new/choose).
  Search existing issues first. Never paste an nsec, an NWC connection string, a seed phrase or an invoice
  containing private information.
- **Pick up an issue** labelled `good first issue` or `help wanted`. Comment on it first so work is not duplicated.
- **Improve the docs** in [`docs/`](docs/) or this repository's README.

## Development setup

You need Node.js (the exact version is pinned in `.nvmrc`), npm, and the Android SDK (and Xcode on macOS for
iOS). See [`docs/INSTALLATION.adoc`](docs/INSTALLATION.adoc) for the full walkthrough.

```sh
git clone https://github.com/BenGWeeks/lightning-piggy-mobile.git
cd lightning-piggy-mobile
nvm install && nvm use   # reads .nvmrc
npm ci
```

The app uses custom native modules, so it cannot run in Expo Go. Build and install a development build once,
then serve JavaScript to it from Metro:

```sh
npm run android:dev   # or: npx expo run:android   (iOS: npm run ios:dev)
npm start             # Metro with --dev-client
```

Use `npm start` rather than `npx expo start`: the script passes `--dev-client`, which is required for the
custom native modules. (`expo-dev-client` is not listed as a dependency; the `--dev-client` flag together
with the native development build produced by `expo run:android` / `expo run:ios` is what works.) Re-run the
native build after changing plugins or native modules.

## Checks that must pass

CI runs these on every pull request. Run them locally before you push:

```sh
npx tsc --noEmit                         # TypeScript (strict mode)
npm run lint                             # ESLint
npm run format:check                     # Prettier (npm run format to fix)
npm test                                 # Jest unit tests
bash scripts/check-perf-antipatterns.sh  # performance rules (see below)
bash scripts/check-file-size.sh          # file-size cap (see below)
```

## Code conventions

- **TypeScript strict mode**, formatted with Prettier (`.prettierrc`) and linted with ESLint.
- **Branded dialogs and toasts.** Use `Alert` from `src/components/BrandedAlert.tsx` and `Toast` from
  `src/components/BrandedToast.tsx`, not React Native's `Alert.alert` or `react-native-toast-message`
  directly. ESLint enforces this.
- **Styles live in their own file**: `src/styles/<Name>.styles.ts`, exporting
  `create<Name>Styles = (colors: Palette) => StyleSheet.create({...})`. Do not inline `StyleSheet.create`
  in a component.
- **File-size cap: no source file over 1,000 lines.** Split by concern (presentation, pure data-shaping, one
  sub-view, one set of actions), not by arbitrary line count. When you touch an over-cap file, leave it
  smaller, never larger.
- **Performance.** The app runs on a single JS thread, so relay events, crypto and taps queue behind each
  other. Never `setState` per relay event (batch with `useCoalescedMap`), arm subscriptions with
  `useFocusEffect`, stagger `AppState` resume work, bound relay filters, memoise list rows and context
  values, and lazy-load new screens. `scripts/check-perf-antipatterns.sh` gates the mechanical rules; the
  rationale is in [`docs/PERFORMANCE.adoc`](docs/PERFORMANCE.adoc).
- **Secrets stay local.** Private keys and NWC URLs belong in secure storage only. LNURL withdraw tokens are
  never published to relays. See [`docs/SECURITY.adoc`](docs/SECURITY.adoc).

### Terminology and wording

- The brand is always **Lightning Piggy**. Never shorten it to "LP" in user-facing text (internal
  identifiers and code comments are fine).
- Geo-caches published by the app are **Piglets** (the wallet is the "Piggy", a cache stash is its
  "Piglet"). Cache listings that do not come from Lightning Piggy stay "NIP-GC cache".
- **Keep "sats" in Latin letters in every translation.** Do not transliterate the unit into the target script.

## Testing

- **Unit tests** use Jest (`jest-expo`). Add co-located `*.test.ts` files next to the code under
  `src/services`, `src/utils` or `src/contexts` (only `src/**/*.test.{ts,tsx}` is collected). Components are
  covered by end-to-end flows instead. CI fails a PR that drops line coverage by more than 0.5 percentage points.
- **End-to-end tests** use [Maestro](https://maestro.mobile.dev) flows in [`.maestro/`](.maestro/), organised
  by feature area (see [`.maestro/README.adoc`](.maestro/README.adoc)).
  - Give every interactive element an `accessibilityLabel` and/or `testID`, and select by `id:` or `text:`.
  - **Never use screen coordinates** (`point:`, `adb shell input tap`) for the app's own UI. If an element
    lacks a label, add one in the source. The only exception is OS-owned surfaces the app cannot instrument
    (system photo picker, camera, third-party WebViews).
  - Maestro flows must only use test identities and test wallets, never real funds or personal keys.
- More detail: [`docs/TESTING.adoc`](docs/TESTING.adoc).

## Pull requests

1. Open or find an issue first, and branch from `main`.
2. Keep the PR **small and targeted**: fix the reported defect or build the requested feature, nothing
   speculative.
3. Use a [Conventional Commits](https://www.conventionalcommits.org/) title, with the issue reference at the end:

   ```text
   <type>(<scope>): <short description> (#<issue>)
   ```

   Types: `feat`, `fix`, `perf`, `refactor`, `chore`, `ci`, `docs`, `deps`, `test`, `build`, `style`.
   Use imperative mood, lower case, no trailing period. Example:
   `fix(receive): select amount input text on focus to prevent stale-append (#104)`.

4. Fill in the [pull request template](.github/PULL_REQUEST_TEMPLATE.md). `feat`, `fix`, `perf` and
   `refactor` PRs need a `Closes #N` line, and every PR needs a `## Test plan` section (or
   `N/A - <reason>`). The `PR Lint` check enforces this.
5. **Include before/after screenshots for any UI change.**
6. Make sure all checks above pass, then address review comments until no threads are unresolved.

## Documentation

Deeper design and operational notes live in [`docs/`](docs/): architecture
([`ARCHITECTURE.adoc`](docs/ARCHITECTURE.adoc)), supported protocols ([`PROTOCOLS.adoc`](docs/PROTOCOLS.adoc),
[`STANDARDS.adoc`](docs/STANDARDS.adoc)), releases ([`DEPLOYMENT.adoc`](docs/DEPLOYMENT.adoc)) and known
problems ([`TROUBLESHOOTING.adoc`](docs/TROUBLESHOOTING.adoc)). If you hit and resolve a development issue,
please add it to the troubleshooting guide.
