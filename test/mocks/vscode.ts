// Minimal mock of the virtual 'vscode' module for the RARE adapter specs run under Vitest.
// The pure core (src/core/**) never imports 'vscode' and therefore does not need this mock.
// Extend it as the real needs of the adapter tests arise.

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

export const l10n = {
  t: (message: string, ...args: unknown[]): string => {
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
      const record = args[0] as Record<string, unknown>;
      return message.replace(/\{(\w+)\}/g, (_m, key: string) => String(record[key] ?? ''));
    }
    return message.replace(/\{(\d+)\}/g, (_m, i: string) => String(args[Number(i)] ?? ''));
  },
};

export const env = {
  language: 'en',
};
