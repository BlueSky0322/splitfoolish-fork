// Lint rules for the app (src), the Worker (worker) and the code they share (shared).
// TypeScript files are checked with type information, as the README recommends.

import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'coverage', '.wrangler', 'node_modules'] },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // Files outside a tsconfig: the Worker's Node-run tests and the build configs
          allowDefaultProject: ['worker/test/*.ts', 'vitest.config.ts', '*.config.js'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // The app
  {
    files: ['src/**/*.{ts,tsx}'],
    ...react.configs.flat.recommended,
    languageOptions: {
      ...react.configs.flat.recommended.languageOptions,
      globals: globals.browser,
    },
    settings: { react: { version: 'detect' } },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ...react.configs.flat['jsx-runtime'],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  {
    rules: {
      // React and DOM handlers may return a promise; nothing awaits them, which is fine
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      // Props are typed with TypeScript instead
      'react/prop-types': 'off',
      // Apostrophes in text are harmless in JSX
      'react/no-unescaped-entities': 'off',
    },
  },

  // Tests read JSON responses loosely; that's fine there
  {
    files: ['**/*.test.{ts,tsx}', 'worker/test/**'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // The service worker and other plain JavaScript: no type information
  {
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ['public/sw.js'],
    languageOptions: { globals: globals.serviceworker },
  },
  {
    files: ['*.config.{js,ts}', 'worker/test/**'],
    languageOptions: { globals: globals.node },
  },
);
