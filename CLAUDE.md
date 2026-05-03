# Lightning Piggy Mobile

## Development

- Use `npm start` (not `npx expo start`) — the start script includes `--dev-client` which is required for custom native modules
- Native rebuild required after changing plugins or native modules: `npx expo run:android`

## Deploying a release APK to a physical device

- The user's primary device is a Pixel running an EAS-built production install. **`npx expo run:android --variant release` will not upgrade it** — locally-signed APK fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE` (different keystore than EAS) and `INSTALL_FAILED_VERSION_DOWNGRADE` (local versionCode resets to 1 every prebuild, while EAS's remote counter is in the high 20s).
- To preserve the user's app data (wallets, Nostr login, message history), use `eas build --local --profile production --platform android --non-interactive` instead. This runs EAS's pipeline on this machine, fetches the EAS upload keystore so the signature matches, and uses the remote-incremented versionCode. Sideload with `adb -s <serial> install -r build-*.apk` (note: `adb` takes the serial, `expo run:android --device` takes the model name like `Pixel_8`).
- Full recipe + rationale (case 1 vs case 2) lives in `docs/DEPLOYMENT.adoc` → "Local production builds". When a deploy fails for one of these reasons, update that section if anything's changed.

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

## Code Style

- Prettier and ESLint must pass before committing
- TypeScript strict mode — `npx tsc --noEmit` must pass
- Use the branded `Alert` from `src/components/BrandedAlert.tsx`, not React Native's native `Alert.alert` — the branded one matches the app's theme (pink/blue) and is testable via `id: 'branded-alert-button-N'` in Maestro flows. ESLint enforces this via `no-restricted-imports`.

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
