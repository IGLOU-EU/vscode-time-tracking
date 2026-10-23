import { defineConfig } from '@vscode/test-cli';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

const here = import.meta.dirname;

// The suite also runs on the oldest editor engines.vscode accepts, so an API or a manifest field
// missing there fails here instead of on a user's older editor.
const floor = JSON.parse(readFileSync(path.join(here, 'package.json'), 'utf8')).engines.vscode.replace(/^\^/, '');

const shared = {
  mocha: { ui: 'tdd', timeout: 20000, color: true },
  launchArgs: [
    '--disable-extensions',
    '--user-data-dir',
    path.join(here, '.vscode-test', 'user-data'),
  ],
  // To prove VSCodium compatibility in CI, point to a local binary:
  // useInstallation: { fromPath: process.env.VSCODIUM_PATH },
};
const singleFolder = { ...shared, files: 'out/test/*.test.js', workspaceFolder: './test-fixtures/sample-workspace' };
// Folder settings behave differently once a window holds several folders, so they get their own window.
const multiRoot = {
  ...shared,
  files: 'out/test/multi-root/*.test.js',
  workspaceFolder: './test-fixtures/multi-root/multi-root.code-workspace',
};

export default defineConfig([
  { label: 'integration', version: 'stable', ...singleFolder },
  { label: 'integration-multi-root', version: 'stable', ...multiRoot },
  { label: 'floor', version: floor, ...singleFolder },
  { label: 'floor-multi-root', version: floor, ...multiRoot },
]);
