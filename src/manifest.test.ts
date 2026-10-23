// The manifest and the README cannot import code, so the facts they repeat are held here.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NUMBER_BOUNDS, normalizeSettings, type SettingReader } from './core/settings';
import { EXPORT_DATE_FORMATS } from './core/timesheet';

interface MenuItem {
  command: string;
  when?: string;
}

interface ContributedSetting {
  type: string;
  default: unknown;
  minimum?: number;
  maximum?: number;
  enum?: string[];
}

const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
  engines: { vscode: string };
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
  contributes: {
    commands: { command: string; icon?: string }[];
    menus: Record<string, MenuItem[]>;
    views: Record<string, { id: string }[]>;
    configuration: { properties: Record<string, ContributedSetting> };
  };
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

describe('integration suite', () => {
  it('builds the bundle and the tests before it runs', () => {
    // The host loads the extension from main (dist/) and the runner loads the compiled tests (out/).
    // npm runs pre<script> before <script> on its own, extra arguments included:
    // https://docs.npmjs.com/cli/v10/using-npm/scripts#pre--post-scripts
    const before = manifest.scripts['pretest:integration'] ?? '';
    expect(before).toContain('npm run compile');
    expect(before).toContain('tsconfig.test.json');
  });

  const runs = async () =>
    (await import(pathToFileURL('.vscode-test.mjs').href)).default as { version?: string; useInstallation?: object }[];

  it('downloads each editor at an exact version', async () => {
    // 'stable' changes what a run tests without a commit, and keeps one more build per release.
    const downloaded = (await runs()).filter((r) => r.useInstallation === undefined);
    expect(downloaded.map((r) => r.version).filter((v) => !/^\d+\.\d+\.\d+$/.test(v ?? ''))).toEqual([]);
  });

  it('runs on the engines.vscode floor', async () => {
    expect((await runs()).map((r) => r.version)).toContain(floor);
  });
});

describe('contributed menus', () => {
  const { commands, menus, views } = manifest.contributes;
  const items = Object.values(menus).flat();
  const viewIds = Object.values(views)
    .flat()
    .map((v) => v.id);

  it('cites only contributed commands', () => {
    const contributed = commands.map((c) => c.command);
    expect(items.map((i) => i.command).filter((id) => !contributed.includes(id))).toEqual([]);
  });

  it('shows a menu item only on a contributed view', () => {
    // A view id misspelt in a when clause hides its item without any error.
    const named = items.flatMap((i) => [...(i.when ?? '').matchAll(/\bview(?: == |\.)([\w.]+?)(?:\.visible\b|$|\s)/g)].map((m) => m[1]));
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((id) => !viewIds.includes(id))).toEqual([]);
  });

  it('gives each title bar action of a view an icon', () => {
    // Without one, the title bar shows the action as text.
    const withoutIcon = menus['view/title']
      .map((i) => i.command)
      .filter((id) => !/^\$\([a-z-]+\)$/.test(commands.find((c) => c.command === id)?.icon ?? ''));
    expect(withoutIcon).toEqual([]);
  });
});

describe('contributed settings', () => {
  const { properties } = manifest.contributes.configuration;
  const keyOf = (id: string): string => id.slice('timeTracking.'.length);
  const manifestDefault: SettingReader = (key) => properties[`timeTracking.${key}`]?.default;

  it('reads every contributed setting, and nothing else', () => {
    const read = new Set<string>();
    normalizeSettings((key) => {
      read.add(key);
      return manifestDefault(key);
    }, manifestDefault);
    expect([...read].sort()).toEqual(Object.keys(properties).map(keyOf).sort());
  });

  it('contributes a default that each setting accepts as is', () => {
    // The core falls back on these defaults without checking them again.
    const fallback: SettingReader = (key) => {
      throw new Error(`the default of ${key} needed a fallback`);
    };
    expect(() => normalizeSettings(manifestDefault, fallback)).not.toThrow();
    for (const [id, setting] of Object.entries(properties).filter(([, p]) => p.type === 'number')) {
      const { minimum, maximum = Infinity } = setting;
      expect(setting.default, id).toBeGreaterThanOrEqual(minimum ?? -Infinity);
      expect(setting.default, id).toBeLessThanOrEqual(maximum);
    }
  });

  it('declares the bounds the core holds a number setting within', () => {
    const declared = Object.fromEntries(
      Object.entries(properties)
        .filter(([, p]) => p.type === 'number')
        .map(([id, p]) => [keyOf(id), { minimum: p.minimum, maximum: p.maximum }]),
    );
    expect(declared).toEqual(NUMBER_BOUNDS);
  });

  it('offers the export date formats the timesheet renders', () => {
    expect(properties['timeTracking.exportDateFormat'].enum).toEqual(EXPORT_DATE_FORMATS);
  });
});
