# Lightning Piggy Mobile

## Development

- Use `npm start` (not `npx expo start`) — the start script includes `--dev-client` which is required for custom native modules
- Native rebuild required after changing plugins or native modules: `npx expo run:android`

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
