# Lightning Piggy Mobile

## Development

- Use `npm start` (not `npx expo start`) — the start script includes `--dev-client` which is required for custom native modules
- Native rebuild required after changing plugins or native modules: `npx expo run:android`

## Testing

- E2E tests use Maestro and live in `tests/e2e/`
- Install Maestro: `curl -Ls "https://get.maestro.mobile.dev" | bash`
- Run tests: `maestro test tests/e2e/<test-file>.yaml`
- **Always use accessibility labels and testIDs for element selectors, never coordinates** — coordinates break on different screen sizes and devices
- All interactive elements (buttons, tabs, alphabet letters, etc.) must have `accessibilityLabel` and/or `testID` props
- Tab bar buttons use `tabBarButtonTestID` (e.g., `tab-friends`)
- Alphabet sidebar letters use `testID` pattern `alphabet-{letter}` (e.g., `alphabet-M`)

## Code Style

- Prettier and ESLint must pass before committing
- TypeScript strict mode — `npx tsc --noEmit` must pass
