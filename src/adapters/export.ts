// Adapter: the timesheet export flow. Bridges the vscode API (save dialog, file write, the
// remembered output folder in workspaceState) to the pure core (buildDays, renderTimesheet).
// The composition root only wires the live project and settings getters in.
import * as vscode from 'vscode';
import * as path from 'node:path';

import { monthKey } from '../core/aggregate';
import { buildDays, type HistoryDay } from '../core/history';
import { renderTimesheet, type ExportColumn, type ExportDateFormat } from '../core/timesheet';
import type { ExportOpen, ExportRequest } from './history-view';
import type { Logger } from './logger';
import type { StorageAdapter } from './storage';

/** Live values the flow reads at call time (project and settings can change without a reload). */
export interface ExportContext {
  getProjectId(): string | undefined;
  getFolderPath(): string | undefined;
  getSettings(): {
    projectName: string;
    columns: readonly ExportColumn[];
    separator: string;
    dateFormat: ExportDateFormat;
    defaultReason: string;
  };
}

/** The three operations the export modal needs, in HistoryDataPort shape. */
export interface ExportFlow {
  getExportOpen(): Promise<ExportOpen>;
  browseExportPath(suggested: string): Promise<string | null>;
  runExport(request: ExportRequest): Promise<string | null>;
}

// The last output folder is remembered per project in workspaceState (silent, not a user-facing
// setting).
const LAST_FOLDER_KEY = 'export.lastFolder';

export function createExportFlow(
  storage: StorageAdapter,
  workspaceState: vscode.Memento,
  logger: Logger,
  ctx: ExportContext,
): ExportFlow {
  async function allExportDays(): Promise<HistoryDay[]> {
    const projectId = ctx.getProjectId();
    if (!projectId) return [];
    // No open markers: the export is a permanent snapshot, so it only carries committed time (the
    // in-progress session may still be re-cut or discarded as below the minimum session length).
    return buildDays(await storage.readAllTagged(projectId, { includeOpen: false }), {});
  }

  function monthLabel(value: string): string {
    const date = new Date(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, 1);
    return new Intl.DateTimeFormat(vscode.env.language, { month: 'long', year: 'numeric' }).format(date);
  }

  function defaultExportFileName(value: string): string {
    const year = value.slice(0, 4);
    const monthName = new Intl.DateTimeFormat('en', { month: 'long' }).format(
      new Date(Number(year), Number(value.slice(4, 6)) - 1, 1),
    );
    return `${year}_${monthName}_timesheet.csv`;
  }

  async function getExportOpen(): Promise<ExportOpen> {
    const days = await allExportDays();
    const months = [...new Set(days.filter((d) => d.sessions.length > 0).map((d) => d.date.slice(0, 6)))]
      .sort()
      .reverse();
    const now = new Date();
    const prevKey = monthKey(now.getFullYear(), now.getMonth() - 1);
    const defaultMonth = months.includes(prevKey) ? prevKey : (months[0] ?? null);
    const folder = workspaceState.get<string>(LAST_FOLDER_KEY) ?? ctx.getFolderPath() ?? '';
    const fileName = defaultMonth ? defaultExportFileName(defaultMonth) : 'timesheet.csv';
    return {
      months: months.map((value) => ({ value, label: monthLabel(value), fileName: defaultExportFileName(value) })),
      defaultMonth,
      defaultPath: folder ? path.join(folder, fileName) : fileName,
    };
  }

  async function browseExportPath(suggested: string): Promise<string | null> {
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(suggested),
      filters: { CSV: ['csv'] },
      saveLabel: vscode.l10n.t('Export'),
    });
    return uri ? uri.fsPath : null;
  }

  async function runExport(request: ExportRequest): Promise<string | null> {
    const projectId = ctx.getProjectId();
    if (!projectId) return vscode.l10n.t('Open a project folder to export.');
    // Bound the read to the exported month instead of re-reading the whole history (the modal
    // already paid that full read for the month list). The one-day slack of readAllTagged brings
    // in a session started on the eve, and the day filter then keeps exactly the month.
    const monthStart = new Date(Number(request.month.slice(0, 4)), Number(request.month.slice(4, 6)) - 1, 1).getTime();
    const tagged = await storage.readAllTagged(projectId, { sinceMs: monthStart, includeOpen: false });
    const days = buildDays(tagged, {}).filter((d) => d.date.slice(0, 6) === request.month);
    const folderPath = ctx.getFolderPath();
    const settings = ctx.getSettings();
    const project = settings.projectName || (folderPath ? path.basename(folderPath) : 'project');
    const csv = renderTimesheet(days, {
      granularity: request.granularity,
      columns: settings.columns,
      separator: settings.separator,
      dateFormat: settings.dateFormat,
      project,
      defaultReason: settings.defaultReason,
    });
    if (!csv) return vscode.l10n.t('No tracked time for this month.');
    const target = path.isAbsolute(request.path) ? request.path : path.join(folderPath ?? '', request.path);
    try {
      await vscode.workspace.fs.writeFile(vscode.Uri.file(target), new TextEncoder().encode(csv));
    } catch (e) {
      return vscode.l10n.t('Could not write the file: {error}', { error: String(e) });
    }
    await workspaceState.update(LAST_FOLDER_KEY, path.dirname(target));
    logger.log('export', { month: request.month, granularity: request.granularity, path: target });
    void vscode.window.showInformationMessage(vscode.l10n.t('Timesheet exported to {path}', { path: target }));
    return null;
  }

  return { getExportOpen, browseExportPath, runExport };
}
