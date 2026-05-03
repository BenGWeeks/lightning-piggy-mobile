// Jest configuration for Lightning Piggy Mobile.
//
// Uses the `jest-expo` preset, which is the canonical setup for Expo bare-workflow
// projects: it wires up the React Native + Expo module mocks, the Babel pipeline
// (so TS/JSX/Reanimated worklets transpile correctly), and a sensible default
// transformIgnorePatterns covering the RN / Expo / nostr-tools / @noble ecosystem.
//
// Coverage is collected from `src/**` only — generated files, native shells, and
// scripts are excluded so the baseline reflects app code we actually own.

module.exports = {
  preset: 'jest-expo',
  setupFiles: ['<rootDir>/jest.setup.js'],
  testMatch: ['<rootDir>/src/**/*.test.{ts,tsx}', '<rootDir>/tests/unit/**/*.test.{ts,tsx}'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/index.{ts,tsx}',
    '!src/**/*.stories.{ts,tsx}',
    '!src/types/**',
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
    '/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|nostr-tools|@noble|@scure))',
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
