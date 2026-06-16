import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// Vitest drives the TDD loop on the pure core (src/core/**), without the VSCode binary.
// The 'vscode' alias is only used by the rare adapter specs. The core never imports 'vscode'.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/test/**', 'node_modules/**', 'out/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**'],
      reporter: ['text', 'html'],
    },
  },
  resolve: {
    alias: {
      vscode: resolve(__dirname, 'test/mocks/vscode.ts'),
    },
  },
});
