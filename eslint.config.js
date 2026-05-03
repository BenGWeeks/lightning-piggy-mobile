const { FlatCompat } = require('@eslint/eslintrc');
const typescriptParser = require('@typescript-eslint/parser');
const typescriptPlugin = require('@typescript-eslint/eslint-plugin');
const globals = require('globals');

const compat = new FlatCompat();

module.exports = [
  {
    ignores: ['node_modules/**', '.expo/**', 'babel.config.js', 'eslint.config.js'],
  },
  ...compat.extends('expo', 'prettier'),
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: typescriptParser,
    },
    plugins: {
      '@typescript-eslint': typescriptPlugin,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    // Standalone Node ESM helpers under scripts/ run in Node, not in the
    // React Native runtime, so give them access to Node globals like
    // setTimeout and process.
    files: ['scripts/**/*.mjs', 'scripts/**/*.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // Block React Native's native `Alert` outside BrandedAlert.tsx itself
    // so every alert renders through the in-app branded modal (matches
    // the app's pink/blue theme and is testable via Maestro). The
    // whitelist on BrandedAlert.tsx is defence-in-depth — that file
    // wraps RN's `Modal` and does not currently import `Alert` from
    // 'react-native', but a future re-export for parity testing would
    // legitimately need to. See CLAUDE.md → "Code Style".
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: ['src/components/BrandedAlert.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react-native',
              importNames: ['Alert'],
              message: "Use Alert from 'src/components/BrandedAlert' instead — see CLAUDE.md.",
            },
          ],
        },
      ],
    },
  },
];
