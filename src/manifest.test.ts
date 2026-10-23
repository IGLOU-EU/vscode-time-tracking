// The manifest and the README cannot import code, so the facts they repeat are held here.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
  engines: { vscode: string };
  devDependencies: Record<string, string>;
};
const floor = manifest.engines.vscode.replace(/^\^/, '');

describe('minimum editor version', () => {
  it('pins the editor API types to the engines.vscode floor', () => {
    // A caret resolves to the latest types, where an API newer than the floor type-checks.
    expect(manifest.devDependencies['@types/vscode']).toBe(`~${floor}`);
  });

  it('states the engines.vscode floor in the README', () => {
    const [major, minor] = floor.split('.');
    expect(readFileSync('README.md', 'utf8')).toContain(`VSCodium ${major}.${minor} or later`);
  });
});
