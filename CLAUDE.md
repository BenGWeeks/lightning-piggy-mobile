# Lightning Piggy Mobile

## Development

- Use `npm start` (not `npx expo start`) — the start script includes `--dev-client` which is required for custom native modules
- Native rebuild required after changing plugins or native modules: `npx expo run:android`

## Cutting a release

- **Releases go through the GitHub Release workflow, not via `eas build --local`.** Bump with `npm version <patch|minor|major>`, push `main --follow-tags`, then publish a GitHub Release pointing at the tag. `.github/workflows/release.yml` kicks off EAS cloud builds for both platforms, auto-submits iOS to TestFlight, and attaches the Android APK to the Release page. Full recipe in `docs/DEPLOYMENT.adoc` → "Cutting a release".
- **Why not run `eas build` manually for releases?** Manual / local builds aren't anchored to a published tag — the artifact came from whatever local checkout (or whichever commit) you triggered it from, with no record of which source revision actually shipped. The GitHub Release notes then drift away from what's in users' hands. The workflow tags first, then builds, so the artifacts are pinned to one commit.
- **Marketing version lives in `package.json` / `app.config.ts`** (single source of truth, reviewable via PR). **`versionCode` / `buildNumber` are owned by EAS's remote counter** (`eas.json` → `"appVersionSource": "remote"` + `"autoIncrement": true`). Don't hand-edit the integer for releases — cloud builds auto-increment it past whatever's in the file.

## Sideloading a release-flavor APK to a physical device (for testing, not release)

- The user's primary device is a Pixel running an EAS-built install. A locally-signed APK won't upgrade it (`INSTALL_FAILED_UPDATE_INCOMPATIBLE` — different keystore). To validate release-mode behavior on real hardware without losing app data, pull a cloud-built production APK instead of running `eas build --local`:
  ```
  # 0. The APK you install must actually contain the code under test. The
  #    "latest" finished build may be the PREVIOUS release — if your fix
  #    isn't merged + cloud-built yet, kick off a build of it first and
  #    download THAT one (by id), rather than blindly taking --limit 1:
  #      eas build --profile production --platform android
  # 1. Otherwise, find the most-recent production build's URL / ID.
  eas build:list --platform android --profile production --status finished --limit 1
  # 2. Download THAT build by URL or ID — don't use `--latest`, since it
  #    isn't constrained to a profile and may hand back a development/
  #    preview APK (which uses the `.dev` / `.preview` applicationId
  #    and won't upgrade a production install).
  eas build:view <build-id> --json | jq -r '.artifacts.buildUrl' | xargs -I{} curl -L -o build.apk {}
  adb -s <serial> install -r build.apk
  ```
- `adb` takes the adb serial; `expo run:android --device` takes the model name (`Pixel_8`). For dev iteration, `npx expo run:android --device Pixel_8` is still the right call — release-mode sideload is only needed when validating R8 / proguard behavior.
- `eas build --local` survives as an offline fallback (no network, urgent). Documented in `docs/DEPLOYMENT.adoc` → "Local production builds (fallback)". It requires manually bumping `versionCode` in `app.config.ts` first, and is not the release path.

## Testing

- E2E tests use Maestro and live in `.maestro/`, organised one folder deep by feature area (`authentication/`, `wallets/`, `payments/`, `messaging/`, `groups/`, `friends/`, `hunt/`, `profile/`, `map/`, `ui/`, `cards/`). Composed flows are named `flow-NNN-<description>.yaml` (globally sequential); shared building blocks live un-numbered in `common/` and are pulled in via `runFlow` (never run on their own). `perf/` and `keyboard-audit/` are kept as their own sub-sections. See `.maestro/README.adoc` for the full layout + the relay/identity safety rules.
- Install Maestro: `curl -Ls "https://get.maestro.mobile.dev" | bash`
- Run one flow: `maestro test .maestro/<area>/flow-NNN-<name>.yaml` · Run the curated wallet/transfer suite: `source .env && bash .maestro/reporting/run-all.sh`
- A **disabled** nightly Maestro Cloud workflow (`.github/workflows/maestro-nightly.yml`) is scaffolded — gated off behind `vars.ENABLE_MAESTRO_NIGHTLY`; enable only with a Maestro Cloud subscription.
- **NEVER use coordinates (`point:`, `tapOn: { point: }`, `adb shell input tap`) for the app's own UI** — coordinates are fragile and break across screen sizes, devices, and OS versions. Always add `accessibilityLabel` and/or `testID` props to components and use `id:` or `text:` selectors in Maestro instead. The *only* exception is **OS-owned surfaces the app can't instrument** — the system photo picker / image crop, the camera, and third-party WebViews — which expose no testID or label to the app; there `point:` is a documented last resort (see the picker/crop taps in the `attach-*` and `profile-image` flows). If an element is in *our* UI, add a testID — never reach for coordinates.
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

## Performance rules

Everything below exists because the app runs on ONE JS thread — relay events, crypto, and tap dispatch all queue behind each other (see #554's dead-tap wedge). `bash scripts/check-perf-antipatterns.sh` gates the mechanical rules in CI (grandfathered baseline — shrink counts, never grow them). Full rationale + the audit methodology: `docs/PERFORMANCE.adoc` → "Authoring best practices".

- **Never `setState` per relay/emitter event.** Batch ingest through `src/utils/useCoalescedMap.ts` (≤150 ms coalesced flush). Per-event `new Map(prev)` clones are CI-gated.
- **Screens arm subscriptions with `useFocusEffect`**, never bare `useEffect` — blurred tabs must not keep relay subs alive. One hook instance owns a subscription; sibling screens receive data via params/context, never a duplicate sub (#1028).
- **AppState `active` handlers stagger.** Only latency-sensitive work (DM re-arm) fires immediately on resume; everything else (cache refetches, polls) schedules via a cancellable ~3 s `setTimeout` (pattern: `useCacheNotifications`, #554/#1031). Never add an unstaggered resume handler.
- **Relay filters are always bounded** — `limit` plus a `since` window where semantics allow. Exception: kind-1059 gift wraps must NOT use `since` (NIP-59 randomises `created_at` up to 48 h back — #469); bound those by `limit` and reconcile on re-arm.
- **Heavy loops yield.** Multi-recipient crypto / batch decrypt uses the budget-gated `createYieldScheduler` (`src/services/nostrDecryptPacing.ts`) between units — not unconditional `yieldToEventLoop()` (a forced 16 ms RAF per item).
- **List rows are `React.memo`'d** with stable props; images in lists use `expo-image` with `cachePolicy="memory-disk"` (bare react-native `Image` is CI-gated); long lists use `FlatList`/`FlashList` with `keyExtractor`, never `ScrollView` over unbounded data.
- **Context provider `value`s are `useMemo`'d, handlers `useCallback`'d** — one inline object literal re-renders every consumer.
- **New screens are `lazyScreen`'d** in `AppNavigator`; heavy native modules never import eagerly from tab screens.
- **Don't add crypto to hot paths.** All Nostr crypto is pure-JS today; the fix is the native pipeline (epic #1036, Stage 1 JSI crypto → Stage 2 rust-nostr engine via the bdk-rn UniFFI pattern), not more JS-thread work.
- **Perf-sensitive PRs prove it:** `[PerfBlock]` markers (preview builds set `EXPO_PUBLIC_KEEP_PERF_LOGS=1`) or a `scripts/perf-*.sh` p50/p95 before/after in the PR body. Perf reviews go to Stevie (T-Minus-15 plugin agent).

## Signers

The app supports three Nostr signers, branched on `signerType` in `NostrContext.tsx`:

- `nsec` — local key (`src/services/nostrService.ts`)
- `amber` (NIP-55) — Android only via Intent IPC (`src/services/amberService.ts`)
- `nip46` (NIP-46 / "Nostr Connect") — cross-platform, relay-based; works with Clave (iOS), Aegis, nsec.app (`src/services/nostrConnectService.ts`). See `docs/nip46-clave.adoc` for the pairing flow + the silent-decrypt batch trade-off.

## File size and modularity

- **Aim for elegant, well-organised code — the line cap is a symptom, not the goal.** When a file is too big, the fix is to find the *right* seams and give each module a single, nameable responsibility, NOT to shuffle lines around until the number drops. A split is only worth doing if the result reads better than the original: a reviewer should be able to say what each new file is *for* in one phrase (presentation / pure data-shaping / one sub-view / one set of actions). If an extraction doesn't make the code clearer, it's line-golf — don't do it. Getting under 1,000 lines should fall out of organising the code well.
  - Good example (the `ConversationScreen` split, #703): `*.styles.ts` (presentation), `utils/conversationItems.ts` (pure, testable DM→item shaping), `ConversationMessageRow.tsx` (one memoised row), `useConversationComposerActions.ts` (send/upload/share orchestration). Each is independently understandable; the screen became composition.
- **Hard cap: no source file over 1,000 lines.** A file approaching or past 1,000 lines MUST be broken up into smaller, **logically-cohesive** modules — split by *concern*, not by arbitrary line count. A 4,000-line context/screen is unreviewable, conflict-prone, and hides coupling.
- **New files** must not be created over the cap. **When you touch an existing over-cap file, leave it smaller, never larger** — extract the part you're working on into its own module rather than adding to the blob.
- **Styles ALWAYS live in their own file — never inline a `StyleSheet.create` in a component/screen `.tsx`.** Put it in `src/styles/<Name>.styles.ts` exporting `export const create<Name>Styles = (colors: Palette) => StyleSheet.create({…})` (e.g. `src/styles/MessagesScreen.styles.ts` → `createMessagesScreenStyles`). When an extracted sub-component needs the styles type, also `export type <Name>Styles = ReturnType<typeof create<Name>Styles>`. This is a standing convention for *every* component, not just over-cap ones — styles are pure data that don't close over state, so extracting them is zero-risk and the first thing to pull out. (~90 `.tsx` files still inline their styles as of 2026-05-27 — convert them when you touch them.)
- **How to split (by concern, not by slicing):**
  - **Contexts** → extract per-responsibility hooks/services. E.g. `NostrContext` → `useDmInbox` / `useProfiles` / `useRelays` (+ the `src/services/dm*` data layer), each its own file; the context just composes them.
  - **Screens** → lift sub-views into components, and non-UI logic into hooks/utils (`useXScreenState`, `src/utils/…`). Styles → `src/styles/<Name>.styles.ts` (see above).
  - **Services** → split by domain (`nostrService` → `nostrRelay` / `nostrDm` / `nostrProfile`).
- **Known offenders to break up (counts by `wc -l`, may read ±1 vs an editor's last-line number; update when you touch a file):** `NostrContext.tsx` (3,565 — module-scope helpers extracted; component/hooks still to split toward the cap), `HuntCreateScreen.tsx` (3,121), `WalletContext.tsx` (2,153 — NWC connection watchdog extracted to `useNwcConnectionWatchdog.ts`), `HuntPiggyDetailScreen.tsx` (1,710), `MapScreen.tsx` (1,160 — pin derivation extracted to `useMapPins.ts`), `nostrService.ts` (1,529), `TransferSheet.tsx` (1,418), `ExploreHomeScreen.tsx` (1,377), `nfcService.ts` (1,242), `SendSheet.tsx` (1,176), `GroupConversationScreen.tsx` (1,015). (`nwcService.ts` dropped under the cap in #785 once its relay-health layer moved to `src/services/nwcRelayHealth.ts` — baseline entry removed.) The CI gate (`scripts/check-file-size.sh`) baselines the same `wc -l` numbers, so doc and check agree.

## Unit tests

- Coverage scope: **`src/services`, `src/utils`, `src/contexts` only.** Components are excluded — they're best covered by Maestro pixel/flow tests (mocking Reanimated + bottom-sheet + Image for unit tests is high-effort, low-payoff).
- Runner: Jest via `jest-expo` preset. Per the 2026 review of alternatives (Vitest's RN preset is still WIP, Bun test isn't documented for Expo, node:test has no RN renderer), Jest remains the right choice for RN + Expo SDK 55.
- Add new tests as co-located `.test.ts` files next to the source (e.g. `src/utils/foo.test.ts`). Jest only collects `src/**/*.test.{ts,tsx}` (see `jest.config.js` `testMatch`) — a file under `tests/unit/` is silently never run.
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
