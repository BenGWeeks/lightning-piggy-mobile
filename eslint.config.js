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
      // Force toasts to flow through the brand-themed wrapper. Direct
      // imports of `react-native-toast-message` bypass the pink / blue
      // accent + rounded-corner styling configured in BrandedToast.tsx.
      // The wrapper itself is the only legitimate consumer; an override
      // block below opens a hole specifically for that file.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react-native-toast-message',
              message:
                "Import Toast from 'src/components/BrandedToast' instead — keeps the on-brand pink/blue toast styling consistent across the app.",
            },
          ],
        },
      ],
    },
  },
  {
    // BrandedToast wraps `react-native-toast-message` and MUST be allowed
    // to import it directly. Re-declare the restriction as 'off' for this
    // single file to punch a hole in the global rule above.
    files: ['src/components/BrandedToast.tsx'],
    rules: {
      'no-restricted-imports': 'off',
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
    // Jest setup/config files run under Node with Jest globals available.
    files: ['jest.setup.js', 'jest.config.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
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
              message:
                "Use the branded Alert from src/components/BrandedAlert.tsx instead. Import via the relative path matching this file's location (e.g. '../components/BrandedAlert' from src/screens/, './BrandedAlert' from src/components/). See CLAUDE.md → Code Style.",
            },
          ],
        },
      ],
    },
  },
];
