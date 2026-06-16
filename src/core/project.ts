// Pure core: stable, opaque identifier for a project folder, derived from its absolute path.
// Node's crypto is available under Vitest, so this stays testable without 'vscode'.

import { createHash } from 'node:crypto';

/** Stable 16-hex-char id for a root folder. Trailing separators are ignored. */
export function projectIdFromFsPath(fsPath: string): string {
  const normalized = fsPath.replace(/[\\/]+$/, '');
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}
