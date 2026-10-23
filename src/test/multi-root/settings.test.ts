// Integration tests run in a multi-root workspace, where a folder's own .vscode/settings.json only
// applies to a read that names that folder.
import * as assert from 'node:assert';
import * as vscode from 'vscode';

import { readConfig } from '../../adapters/config';

function folder(name: string): vscode.Uri {
  const found = vscode.workspace.workspaceFolders?.find((f) => f.name === name);
  assert.ok(found, `workspace folder ${name} not found`);
  return found.uri;
}

suite('Settings in a multi-root workspace', () => {
  test('reads the project name of each folder', () => {
    assert.strictEqual(readConfig(folder('alpha')).projectName, 'Alpha');
    assert.strictEqual(readConfig(folder('beta')).projectName, 'Beta');
  });

  test('applies a machine-overridable value only to the folder that sets it', () => {
    const outside = readConfig(undefined).minSessionMs;
    assert.strictEqual(readConfig(folder('alpha')).minSessionMs, 5 * 60_000);
    assert.notStrictEqual(outside, 5 * 60_000);
    assert.strictEqual(readConfig(folder('beta')).minSessionMs, outside);
  });

  test('falls back to the default for a value of the wrong type written by hand', () => {
    const raw = vscode.workspace.getConfiguration('timeTracking', folder('beta')).get('inactivityThresholdMinutes');
    assert.strictEqual(raw, 'abc', 'the editor passes the hand-written value through');
    assert.strictEqual(readConfig(folder('beta')).idleThresholdMs, readConfig(undefined).idleThresholdMs);
  });
});
