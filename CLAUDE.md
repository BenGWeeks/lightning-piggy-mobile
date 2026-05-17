# Lightning Piggy Mobile

## Development

- Use `npm start` (not `npx expo start`) — the start script includes `--dev-client` which is required for custom native modules
- Native rebuild required after changing plugins or native modules: `npx expo run:android`

## Cutting a release

- **Releases go through the GitHub Release workflow, not via `eas build --local`.** Bump with `npm version <patch|minor|major>`, push `main --follow-tags`, then publish a GitHub Release pointing at the tag. `.github/workflows/release.yml` kicks off EAS cloud builds for both platforms, auto-submits iOS to TestFlight, and attaches the Android APK to the Release page. Full recipe in `docs/DEPLOYMENT.adoc` → "Cutting a release".
- **Why not run `eas build` manually for releases?** Manual builds detach the artifact from any tag — anything merged to `main` during the ~30 min build window quietly ends up "released" too, and the GitHub Release notes drift away from what actually shipped. The workflow tags first, then builds, so the artifacts are anchored to one commit.
- **Marketing version lives in `package.json` / `app.config.ts`** (single source of truth, reviewable via PR). **`versionCode` / `buildNumber` are owned by EAS's remote counter** (`eas.json` → `"appVersionSource": "remote"` + `"autoIncrement": true`). Don't hand-edit the integer for releases — cloud builds auto-increment it past whatever's in the file.

## Sideloading a release-flavor APK to a physical device (for testing, not release)

- The user's primary device is a Pixel running an EAS-built install. A locally-signed APK won't upgrade it (`INSTALL_FAILED_UPDATE_INCOMPATIBLE` — different keystore). To validate release-mode behavior on real hardware without losing app data, pull the latest cloud-built APK instead of running `eas build --local`:
  ```
  eas build:list --platform android --profile production --status finished --limit 1   # find the URL
  eas build:download --platform android --latest                                       # or fetch directly
  adb -s <serial> install -r build-*.apk
  ```
- `adb` takes the adb serial; `expo run:android --device` takes the model name (`Pixel_8`). For dev iteration, `npx expo run:android --device Pixel_8` is still the right call — release-mode sideload is only needed when validating R8 / proguard behavior.
- `eas build --local` survives as an offline fallback (no network, urgent). Documented in `docs/DEPLOYMENT.adoc` → "Local production builds (fallback)". It requires manually bumping `versionCode` in `app.config.ts` first, and is not the release path.

## Testing

- E2E tests use Maestro and live in `tests/e2e/`
- Install Maestro: `curl -Ls "https://get.maestro.mobile.dev" | bash`
- Run tests: `maestro test tests/e2e/<test-file>.yaml`
- **NEVER use coordinates (`point:`, `tapOn: { point: }`, `adb shell input tap`) in Maestro tests or when interacting with the app** — coordinates are fragile and break across screen sizes, devices, and OS versions. Always add `accessibilityLabel` and/or `testID` props to components and use `id:` or `text:` selectors in Maestro instead.
- If a component is missing an accessibility label, add one to the source code rather than using coordinates as a workaround
- All interactive elements (buttons, tabs, alphabet letters, etc.) must have `accessibilityLabel` and/or `testID` props
- Tab bar buttons use `tabBarButtonTestID` (e.g., `tab-friends`) and `tabBarAccessibilityLabel` (e.g., `Friends tab`)
- Alphabet sidebar letters use `testID` pattern `alphabet-{letter}` (e.g., `alphabet-M`)
- Maestro selectors: use `id: 'testID-value'` for testID, `text: 'label'` for text/accessibilityLabel

## Naming

- The brand is **Lightning Piggy** — never shorten to "LP" in user-facing strings. "LP" only belongs in internal type / variable names (`isLpPiggy`) and code comments.
- Geo-caches published by this app are called **Piglets** in UI copy (the wallet is the "Piggy", a cache stash is its "Piglet"). Vanilla NIP-GC caches stay "NIP-GC cache".

## Code Style

- Prettier and ESLint must pass before committing
- TypeScript strict mode — `npx tsc --noEmit` must pass
- Use the branded `Alert` from `src/components/BrandedAlert.tsx`, not React Native's native `Alert.alert` — the branded one matches the app's theme (pink/blue) and is testable via `id: 'branded-alert-button-N'` in Maestro flows. ESLint enforces this via `no-restricted-imports`.
- Use the branded `Toast` from `src/components/BrandedToast.tsx`, not `react-native-toast-message` directly — matches the app's pink/blue theme. ESLint enforces this via `no-restricted-imports`.

## Unit tests

- Coverage scope: **`src/services`, `src/utils`, `src/contexts` only.** Components are excluded — they're best covered by Maestro pixel/flow tests (mocking Reanimated + bottom-sheet + Image for unit tests is high-effort, low-payoff).
- Runner: Jest via `jest-expo` preset. Per the 2026 review of alternatives (Vitest's RN preset is still WIP, Bun test isn't documented for Expo, node:test has no RN renderer), Jest remains the right choice for RN + Expo SDK 55.
- Add new tests under `tests/unit/<area>.test.ts`. Co-located `.test.ts` next to source files also works.
- Pick targets via `bash scripts/coverage-priorities.sh 20` — ranks files by `(churn × LOC × fanout) / (coverage% + 1)`. Top of the list is where bugs hurt most.
- The `Coverage` GitHub Actions workflow gates every PR: line-coverage may not drop more than 0.5pp vs main.

## Pull Request Titles

Follow [Conventional Commits](https://www.conventionalcommits.org/) plus a trailing issue reference when the PR resolves one:

```
<type>(<scope>): <short description> (#<issue>)
```

- **type** — `feat`, `fix`, `chore`, `docs`, `refactor`, `perf`, `test`. Use `fix` only when the PR resolves a defect users would notice; `feat` for user-visible additions; `chore` for tooling / infra.
- **scope** — a short noun for the affected area (`nwc`, `dm`, `onboarding`, `receive`, `zap`, `ui`, `nostr`, …). Omit the scope only when the change is truly repo-wide.
- **short description** — imperative mood, lower case, no trailing period. Keep under ~70 characters total including the issue suffix so GitHub doesn't truncate it.
- **issue suffix** — append `(#N)` for the primary issue the PR closes; for a PR that resolves multiple, use `(#N1, #N2)`. Prefer this trailing form over embedding `Closes #N` only in the body, because the PR index and commit history surface the title but not the body. The body should still include a `Closes #N` line so GitHub auto-closes the issue on merge.

Examples from the repo:

- `fix(receive): select amount input text on focus to prevent stale-append (#104)`
- `feat(onboarding): auto-advance IntroScreen, drop "Let's Go" button (#107)`
- `feat(nfc): scan + write Lightning/Nostr tags (#48, #49)`
- `fix(zap): show outgoing zap in conversation thread on send (#123)`

Refactors, infra, or pure-UX polish that doesn't correspond to a filed issue can omit the suffix — don't invent an issue number to fit the format.

## Screenshots

- Always use ADB to capture screenshots from the Android device: `adb exec-out screencap -p > /tmp/screen.png`
- High-DPI devices produce images >2000px which hit Claude's dimension limit. Always resize before reading: `convert /tmp/screen.png -resize 1200x1200\> /tmp/screen_small.png` (uses ImageMagick, `\>` means only shrink, never enlarge)

## Troubleshooting

- See `docs/TROUBLESHOOTING.adoc` for known issues and resolutions
- When you encounter and resolve a development issue, add it to TROUBLESHOOTING.adoc so future developers (and AI assistants) can reference it
- If Claude Code's Bash tool starts failing silently (exit 1 or 134 with empty output), run `df -h /tmp` first — a full tmpfs disables Claude Code's shell snapshot; see TROUBLESHOOTING.adoc → "Claude Code Bash tool fails silently … when /tmp is full"
