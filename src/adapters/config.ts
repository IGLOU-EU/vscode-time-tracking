// Adapter: reads the timeTracking settings for the tracked folder. The core validates them and
// converts them into its units.
import * as vscode from 'vscode';
import { normalizeSettings, type Settings } from '../core/settings';

// In a multi-root workspace, a folder's own settings (scopes resource and machine-overridable) apply
// only to a read that names that folder. Outside any folder, null asks for the value of no particular
// resource, which an unscoped read of a resource setting would log as unexpected.
// https://code.visualstudio.com/api/references/contribution-points#contributes.configuration
// (scopes) and src/vs/workbench/api/common/extHostConfiguration.ts (release/1.82, the null scope).
export function readConfig(folder: vscode.Uri | undefined): Settings {
  const c = vscode.workspace.getConfiguration('timeTracking', folder ?? null);
  // get() with no fallback already returns the manifest default of an unset key. A value of the
  // wrong type gets that same default, read through inspect() instead of restated here.
  return normalizeSettings(
    (key) => c.get(key),
    (key) => c.inspect(key)?.defaultValue,
  );
}

export function onConfigChange(callback: () => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (!e.affectsConfiguration('timeTracking')) return; // early return
    callback();
  });
}
