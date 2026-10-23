import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'out/**',
      'coverage/**',
      '.vscode-test/**',
      'node_modules/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // The History page: a classic browser script, loaded as is by the webview.
    files: ['media/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, acquireVsCodeApi: 'readonly' },
    },
  },
  {
    files: ['esbuild.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      // CommonJS build script: require() is the right call here.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['**/*.mjs', 'vitest.config.ts', '.vscode-test.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
