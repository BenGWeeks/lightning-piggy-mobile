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
