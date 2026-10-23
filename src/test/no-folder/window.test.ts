// Integration tests run in a window opened on no folder, where no project can hold the time.
import * as assert from 'node:assert';
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

const EXTENSION_ID = 'iglou-eu.time-tracking';
// The global storage of the profile that .vscode-test.mjs passes, seen from out/test/no-folder.
const STORAGE = path.resolve(__dirname, '../../../.vscode-test/user-data/User/globalStorage', EXTENSION_ID);

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Every folder and file under the extension storage, with the size of each file, so that any write
// shows as a difference.
async function stored(dir = STORAGE): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const name = path.relative(STORAGE, full);
    if (entry.isDirectory()) found.push(`${name}/`, ...(await stored(full)));
    else found.push(`${name} ${(await fsp.stat(full)).size}`);
  }
  return found.sort();
}

// Sets a user setting and waits for the change to reach the extension, whose listener was
// registered at activation, before this one.
async function setUserSetting(key: string, value: number | undefined): Promise<void> {
  const config = vscode.workspace.getConfiguration('timeTracking');
  if (config.inspect(key)?.globalValue === value) return;
  const seen = new Promise<void>((resolve) => {
    const listener = vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration(`timeTracking.${key}`)) return;
      listener.dispose();
      resolve();
    });
  });
  await config.update(key, value, vscode.ConfigurationTarget.Global);
  await seen;
}

suite('Window without a folder', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension(EXTENSION_ID)?.activate();
  });

  test('opens no folder', () => {
    // The editor reopens an untitled workspace left in the profile, which would give this window a folder.
    assert.strictEqual(vscode.workspace.workspaceFolders, undefined);
  });

  test('activates without throwing', async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `extension ${EXTENSION_ID} not found`);
    await ext.activate();
    assert.strictEqual(ext.isActive, true);
  });

  test('stores nothing of a session worked in an untitled file', async () => {
    // Every session is kept, however short, so the one below would be written if it could be.
    await setUserSetting('minSessionMinutes', 0);
    try {
      const before = await stored();
      await vscode.commands.executeCommand('timeTracking.toggle'); // starts the session, focused or not
      const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content: '' }));
      await editor.edit((edit) => edit.insert(new vscode.Position(0, 0), 'work'));
      await vscode.commands.executeCommand('timeTracking.toggle'); // pauses it, which closes it
      await delay(1_000); // the command does not wait for the write of the closed session
      assert.deepStrictEqual(await stored(), before);
    } finally {
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
      await setUserSetting('minSessionMinutes', undefined);
    }
  });
});
