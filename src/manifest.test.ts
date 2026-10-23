// The manifest and the README cannot import code, so the facts they repeat are held here.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
  engines: { vscode: string };
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
};
const floor = manifest.engines.vscode.replace(/^\^/, '');

// The editor accepts line comments in its own JSON files, JSON.parse does not.
const editorJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, ''));

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

describe('F5 launch configuration', () => {
  const runExtension = () => {
    const launch = editorJson('.vscode/launch.json') as {
      configurations: { type: string; args?: string[]; preLaunchTask?: string }[];
    };
    return launch.configurations.find((c) => c.type === 'extensionHost');
  };

  it('builds through an npm script of the manifest before launching', () => {
    const { tasks } = editorJson('.vscode/tasks.json') as { tasks: { label: string; type: string; script?: string }[] };
    const build = tasks.find((t) => t.label === runExtension()?.preLaunchTask);
    expect(build?.type).toBe('npm');
    expect(Object.keys(manifest.scripts)).toContain(build?.script);
  });

  it('keeps the development host off the daily profile and its extensions', () => {
    const args = runExtension()?.args ?? [];
    expect(args).toContain('--disable-extensions');
    expect(args.some((a) => a.startsWith('--user-data-dir='))).toBe(true);
  });
});
