import { defineConfig } from '@vscode/test-cli';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

const here = import.meta.dirname;

// The newest editor the suite runs on. Pinned, as 'stable' changes what a run tests without a
// commit and downloads every new release into .vscode-test/. Raise it before a release of the
// extension, to the first version listed at https://update.code.visualstudio.com/api/releases/stable
// (`npm run test:integration -- --label integration --code-version stable` tries the latest first),
// then delete the build it replaces under .vscode-test/.
const recent = '1.143.1';

// The suite also runs on the oldest editor engines.vscode accepts, so an API or a manifest field
// missing there fails here instead of on a user's older editor.
const floor = JSON.parse(readFileSync(path.join(here, 'package.json'), 'utf8')).engines.vscode.replace(/^\^/, '');

// VSCodium is not downloaded: VSCODIUM_PATH names the Electron binary of a local install, which
// test-cli runs in place of a download (useInstallation.fromPath, see the IDesktopTestConfiguration
// type of @vscode/test-cli). Without it, the VSCodium runs are left out.
const codium = process.env.VSCODIUM_PATH;

const shared = {
  mocha: { ui: 'tdd', timeout: 20000, color: true },
  launchArgs: [
    '--disable-extensions',
    '--user-data-dir',
    path.join(here, '.vscode-test', 'user-data'),
  ],
};
const singleFolder = { ...shared, files: 'out/test/*.test.js', workspaceFolder: './test-fixtures/sample-workspace' };
// Folder settings behave differently once a window holds several folders, so they get their own window.
const multiRoot = {
  ...shared,
  files: 'out/test/multi-root/*.test.js',
  workspaceFolder: './test-fixtures/multi-root/multi-root.code-workspace',
};

// A window without a folder stores no time, so it gets its own window too. test-cli opens one for an
// entry that names no workspaceFolder (see the DesktopPlatform of @vscode/test-cli).
const noFolder = { ...shared, files: 'out/test/no-folder/*.test.js' };

export default defineConfig([
  { label: 'integration', version: recent, ...singleFolder },
  { label: 'integration-multi-root', version: recent, ...multiRoot },
  { label: 'integration-no-folder', version: recent, ...noFolder },
  { label: 'floor', version: floor, ...singleFolder },
  { label: 'floor-multi-root', version: floor, ...multiRoot },
  { label: 'floor-no-folder', version: floor, ...noFolder },
  ...(codium
    ? [
        { label: 'vscodium', useInstallation: { fromPath: codium }, ...singleFolder },
        { label: 'vscodium-multi-root', useInstallation: { fromPath: codium }, ...multiRoot },
        { label: 'vscodium-no-folder', useInstallation: { fromPath: codium }, ...noFolder },
      ]
    : []),
]);
