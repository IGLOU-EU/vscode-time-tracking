// The History page under media/ is plain browser code that no bundler touches, so it is read here
// as the webview loads it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('history.css', () => {
  it('scales the panel from the editor font size, which a fontSize of 0 leaves in place', () => {
    // The page drops its inline size for 0, and the description of the setting promises the editor
    // size then. --vscode-font-size is the workbench size, a fixed 13px.
    const body = /^body\s*\{([^}]*)\}/m.exec(readFileSync('media/history.css', 'utf8'))?.[1] ?? '';
    expect(body).toMatch(/font-size:\s*var\(--vscode-editor-font-size\b/);
  });
});
