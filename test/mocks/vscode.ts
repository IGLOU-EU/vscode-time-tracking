// Minimal mock of the virtual 'vscode' module for the RARE adapter specs run under Vitest.
// The pure core (src/core/**) never imports 'vscode' and therefore does not need this mock.
// Extend it as the real needs of the adapter tests arise.
import { readFileSync } from 'node:fs';

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

export const Uri = {
  joinPath: (base: unknown, ...segments: string[]): unknown => ({ base, segments }),
};

export class ThemeColor {
  constructor(public readonly id: string) {}
}

export class MarkdownString {
  constructor(public readonly value = '') {}
}

export const window = {
  createStatusBarItem: (): Record<string, unknown> => ({ show() {}, dispose() {} }),
};

// A spec sets 'fr' to read the adapter in French, as the editor does with its display language.
export const env = {
  language: 'en',
};

// The French bundle, used the way the editor uses it: a key it does not hold stays in English.
const FRENCH = JSON.parse(readFileSync('l10n/bundle.l10n.fr.json', 'utf8')) as Record<string, string>;

export const l10n = {
  t: (message: string, ...args: unknown[]): string => {
    const text = env.language === 'fr' ? (FRENCH[message] ?? message) : message;
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
      const record = args[0] as Record<string, unknown>;
      return text.replace(/\{(\w+)\}/g, (_m, key: string) => String(record[key] ?? ''));
    }
    return text.replace(/\{(\d+)\}/g, (_m, i: string) => String(args[Number(i)] ?? ''));
  },
};
