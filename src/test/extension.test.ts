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

  test('registers every command the manifest contributes', async () => {
    // The list comes from the manifest the host loaded, so a new command is checked without a copy here.
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `extension ${EXTENSION_ID} not found`);
    await ext.activate();
    const manifest = ext.packageJSON as { contributes: { commands: { command: string }[] } };
    const contributed = manifest.contributes.commands.map((c) => c.command);
    assert.ok(contributed.length > 0, 'the manifest contributes no command');
    const registered = await vscode.commands.getCommands(true);
    assert.deepStrictEqual(
      contributed.filter((id) => !registered.includes(id)),
      [],
      'contributed commands that the extension does not register',
    );
  });

  test('reveals the history view to open a form from the command palette', async () => {
    // The command goes through the focus command of the view, which the editor names after its id.
    await vscode.extensions.getExtension(EXTENSION_ID)?.activate();
    await vscode.commands.executeCommand('timeTracking.addTime');
  });
});
