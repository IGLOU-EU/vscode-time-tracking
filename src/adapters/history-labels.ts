// Adapter: the History panel words that depend on a count or on the display language. Month and
// weekday names come from Intl, like the day list dates, so every display language gets them
// without a translation of its own.
import * as vscode from 'vscode';
import type { HeatmapLabels } from '../core/charts';

/** A commit count as a phrase, agreed for zero, one and more, since French says "0 commit". */
export function commitsLabel(count: number): string {
  if (count === 0) return vscode.l10n.t('0 commits');
  return count === 1 ? vscode.l10n.t('1 commit') : vscode.l10n.t('{count} commits', { count });
}

/** The heatmap words in the editor display language. A day tooltip reuses the commit phrases. */
export function heatmapLabels(): HeatmapLabels {
  const language = vscode.env.language;
  const month = new Intl.DateTimeFormat(language, { month: 'short' });
  const weekday = new Intl.DateTimeFormat(language, { weekday: 'short' });
  const decimal = new Intl.NumberFormat(language, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return {
    months: Array.from({ length: 12 }, (_, m) => month.format(new Date(2026, m, 1))),
    weekdays: Array.from({ length: 7 }, (_, d) => weekday.format(new Date(2026, 0, 5 + d))), // January 5, 2026 is a Monday
    dayTitle: (date, hours, commits) => {
      const args = { date, hours: decimal.format(hours) };
      return commits === 0
        ? vscode.l10n.t('{date}: {hours} h', args)
        : vscode.l10n.t('{date}: {hours} h, {commits}', { ...args, commits: commitsLabel(commits) });
    },
  };
}
