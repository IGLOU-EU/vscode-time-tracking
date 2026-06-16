import { defineConfig } from '@vscode/test-cli';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// Node 18 does not provide import.meta.dirname, so we derive it from import.meta.url.
const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig([
  {
    label: 'integration',
    files: 'out/test/**/*.test.js',
    version: 'stable',
    workspaceFolder: './test-fixtures/sample-workspace',
    mocha: { ui: 'tdd', timeout: 20000, color: true },
    launchArgs: [
      '--disable-extensions',
      '--user-data-dir',
      path.join(here, '.vscode-test', 'user-data'),
    ],
    // To prove VSCodium compatibility in CI, point to a local binary:
    // useInstallation: { fromPath: process.env.VSCODIUM_PATH },
  },
]);
