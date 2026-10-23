import { afterEach, describe, expect, it } from 'vitest';
import { env } from 'vscode';
import { commitsLabel, heatmapLabels } from './history-labels';

const writableEnv = env as { language: string };
const editorLanguage = writableEnv.language;

describe('history labels', () => {
  afterEach(() => {
    writableEnv.language = editorLanguage;
  });

  it('agrees an English commit count for zero, one and more', () => {
    expect([0, 1, 3].map((n) => commitsLabel(n))).toEqual(['0 commits', '1 commit', '3 commits']);
  });

  it('agrees a French commit count for zero, one and more', () => {
    writableEnv.language = 'fr';
    expect([0, 1, 3].map((n) => commitsLabel(n))).toEqual(['0 commit', '1 commit', '3 commits']);
  });

  it('titles a heatmap day with the same commit phrases, in the display language', () => {
    writableEnv.language = 'fr';
    const { dayTitle } = heatmapLabels();
    expect([0, 1, 3].map((n) => dayTitle('2026-06-14', 3.2, n))).toEqual([
      '2026-06-14 : 3,2 h',
      '2026-06-14 : 3,2 h, 1 commit',
      '2026-06-14 : 3,2 h, 3 commits',
    ]);
  });

  it('names the heatmap months from January and the weekdays from Monday', () => {
    writableEnv.language = 'fr';
    const { months, weekdays } = heatmapLabels();
    expect([months[0], months[5], weekdays[0], weekdays[6]]).toEqual(['janv.', 'juin', 'lun.', 'dim.']);
  });
});
