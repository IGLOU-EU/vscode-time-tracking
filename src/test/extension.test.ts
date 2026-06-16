// Integration smoke tests, run inside a real Extension Host through @vscode/test-cli (Mocha tdd).
import * as assert from 'node:assert';
import * as vscode from 'vscode';

const EXTENSION_ID = 'iglou-eu.time-tracking';

suite('Time Tracking extension', () => {
  test('activates without throwing', async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `extension ${EXTENSION_ID} not found`);
    await ext.activate();
    assert.strictEqual(ext.isActive, true);
  });

  test('registers its commands', async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    await ext?.activate();
    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      'timeTracking.openHistory',
      'timeTracking.pause',
      'timeTracking.resume',
      'timeTracking.ignoreSession',
    ]) {
      assert.ok(commands.includes(id), `missing command: ${id}`);
    }
  });
});
