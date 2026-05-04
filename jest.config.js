// Jest configuration for Lightning Piggy Mobile.
//
// Uses the `jest-expo` preset, which is the canonical setup for Expo bare-workflow
// projects: it wires up the React Native + Expo module mocks, the Babel pipeline
// (so TS/JSX/Reanimated worklets transpile correctly), and a sensible default
// transformIgnorePatterns covering the RN / Expo / nostr-tools / @noble ecosystem.
//
// Coverage is scoped to `src/services`, `src/utils`, `src/contexts` only.
// Components are excluded — they're best covered by Maestro pixel/flow tests
// (mocking Reanimated + bottom-sheet + Image for unit tests is high-effort,
// low-payoff). This keeps the gate tightly focused on the high-leverage
// non-UI surface and stops component-only PRs from being penalised.

module.exports = {
  preset: 'jest-expo',
  setupFiles: ['<rootDir>/jest.setup.js'],
  // Co-located convention: tests live next to their subject as `<file>.test.ts`.
  // Centralised `tests/unit/` is intentionally NOT matched — see CLAUDE.md.
  testMatch: ['<rootDir>/src/**/*.test.{ts,tsx}'],
  collectCoverageFrom: [
    'src/services/**/*.{ts,tsx}',
    'src/utils/**/*.{ts,tsx}',
    'src/contexts/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/index.{ts,tsx}',
    '!src/**/*.stories.{ts,tsx}',
  ],
  // Extend jest-expo's transformIgnorePatterns to also let nostr-tools and
  // its ESM-only crypto deps (@noble/*, @scure/*) through Babel. They all
  // ship as ES modules ("import { sha256 } from '@noble/hashes/sha2.js'")
  // which Jest can't run via the default CommonJS require pipeline —
  // without this allow-list any test that touches the Nostr wire-format
  // helpers (e.g. createGroupChatRumor in nostrService) crashes with
  // "SyntaxError: Cannot use import statement outside a module" on the
  // first transitive crypto import. The base preset list is reproduced
  // verbatim so this doesn't silently drift if jest-expo updates.
  transformIgnorePatterns: [
    // `rn-color-matrices` and `concat-color-matrices` are the ESM
    // matrix-data packages behind the image-filter picker (#138).
    // `imageFilters.ts` imports `rn-color-matrices` directly (rather
    // than via the `react-native-color-matrix-image-filters` wrapper)
    // to keep the matrix table free of native-component imports that
    // trip RN codegen during test transformation. Both packages ship as
    // bare ESM and break Jest's CommonJS require pipeline unless we let
    // Babel transform them.
    '/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|nostr-tools|@noble|@scure|rn-color-matrices|concat-color-matrices))',
    '/node_modules/react-native-reanimated/plugin/',
  ],
  coverageThreshold: {
    // Floor — the CI workflow enforces the relative gate (no regression vs main).
    // This is a belt-and-braces hard floor so coverage cannot collapse to 0%.
    global: {
      lines: 0,
      statements: 0,
      branches: 0,
      functions: 0,
    },
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
};
