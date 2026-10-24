import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: ['**/node_modules/**', '**/dist/**', 'data.sqlite*'],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs,jsx}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^React$', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  // Backend (Lambda), scripts, integration tests: Node.js
  {
    files: ['backend/**/*.js', 'scripts/**/*.js', 'integration/**/*.js', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  // Shared code runs in both the browser and Node.js
  {
    files: ['shared/**/*.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  // Frontend (Amplify): browser + React
  {
    files: ['frontend/**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: '18.3' } },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      'react/prop-types': 'off',
      'react/react-in-jsx-scope': 'off',
    },
  },
  {
    files: ['frontend/test/**/*.js', 'frontend/*.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
];
