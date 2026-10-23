// The key of a translation is the English sentence itself, so a reworded sentence silently loses
// its translation and a new one shows in English. These checks hold the code, the runtime bundle
// and the manifest strings together. Vitest runs from the project root.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The first argument of a vscode.l10n.t call written as a plain string literal.
const LITERAL = /l10n\.t\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g;

const strings = (file: string): Record<string, string> => JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();
const paramsOf = (text: string): string[] => sorted([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));

// The code that ships, read once: every source file but the tests.
const sources = readdirSync('src', { recursive: true, encoding: 'utf8' })
  .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
  .map((file) => ({ file, text: readFileSync(join('src', file), 'utf8') }));

describe('runtime translations', () => {
  const fr = strings('l10n/bundle.l10n.fr.json');
  const literals = sorted(sources.flatMap(({ text }) => [...text.matchAll(LITERAL)].map((m) => m[2].replace(/\\(.)/g, '$1'))));

  it('passes every l10n.t call a plain string literal', () => {
    // Any other key escapes the checks below, and a text translated once and looked up again is a
    // key no bundle holds.
    const calls = sources.flatMap(({ file, text }) => [...text.matchAll(/l10n\.t\((?!\s*['"]).*/g)].map((m) => `${file}: ${m[0]}`));
    expect(calls).toEqual([]);
  });

  it('translates every l10n.t literal of the code into French', () => {
    expect(literals.filter((key) => !(key in fr))).toEqual([]);
  });

  it('keeps no French translation the code no longer asks for', () => {
    expect(Object.keys(fr).filter((key) => !literals.includes(key))).toEqual([]);
  });

  it('keeps the parameters of each English sentence in its French translation', () => {
    const mismatched = Object.entries(fr).filter(([key, value]) => paramsOf(key).join() !== paramsOf(value).join());
    expect(mismatched).toEqual([]);
  });
});

describe('manifest translations', () => {
  const used = sorted([...readFileSync('package.json', 'utf8').matchAll(/%([\w.]+)%/g)].map((m) => m[1]));

  // Both files equal to the keys the manifest uses also means they hold the same keys.
  it.each(['package.nls.json', 'package.nls.fr.json'])('defines every manifest key in %s, and nothing else', (file) => {
    expect(Object.keys(strings(file)).sort()).toEqual(used);
  });
});
