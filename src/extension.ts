// Composition root: wire the VSCode adapters onto the pure core tracker. activate() registers
// every Disposable on context.subscriptions; deactivate() flushes the open interval.
import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';

import { createTracker, type Tracker } from './core/tracker';
import { buildHistoryModel, historyWindowStartMs } from './core/history';
import { formatClock, hoursMinutes } from './core/activity';
import { projectIdFromFsPath } from './core/project';
import { dayKeyLocal } from './core/aggregate';

import { readConfig, onConfigChange } from './adapters/config';
import { createStatusView } from './adapters/status-bar';
import { StorageAdapter } from './adapters/storage';
import { registerSignals } from './adapters/signals';
import { getGitApi, CommitCounts } from './adapters/git';
import { HistoryViewProvider, type HistoryPayload, type HistoryDataPort } from './adapters/history-view';
import { createLogger } from './adapters/logger';

const TICK_MS = 15_000;
const CHECKPOINT_MS = 60_000;
const RECOVERY_STALE_MS = 5 * 60_000;
// The periodic ticks fire at most TICK_MS apart while the host runs. A gap far beyond that means
// the process was frozen (OS sleep, closed lid): the wall clock advanced with nobody present, so
// that span is not work and must not be counted as active time.
const SUSPEND_GAP_MS = 90_000;

let onDeactivate: (() => Promise<void>) | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const windowId = randomUUID();
  const config = readConfig();
  let gitEmail = config.gitUserEmail;
  let fontSizePx = config.fontSizePx;

  const tracker: Tracker = createTracker({
    idleThresholdMs: config.idleThresholdMs,
    backgroundTimeoutMs: config.backgroundTimeoutMs,
    focusCapMs: config.focusCapMs,
    debugIdleCapMs: config.debugIdleCapMs,
    minSessionMs: config.minSessionMs,
  });

  const storage = new StorageAdapter(context.globalStorageUri, windowId);
  const status = createStatusView();
  context.subscriptions.push(status);

  await vscode.workspace.fs.createDirectory(context.globalStorageUri); // so the log file is writable
  const logger = createLogger(vscode.Uri.joinPath(context.globalStorageUri, 'tt-debug.log'), config.debugLogging);
  context.subscriptions.push({ dispose: () => logger.dispose() });
  logger.log('activate', { windowId });

  let currentProjectId: string | undefined;
  let currentFolder: vscode.Uri | undefined;
  let commitCounts: CommitCounts | undefined;
  let watcher: vscode.Disposable | undefined;
  let lastActivityTickAt = 0; // coalesces bursty activity (one keystroke fires 3 events)
  let lastTickAt = 0; // wall-clock of the last time we advanced the tracker, to spot a host suspend

  // History data port: the pure model, formatted with localized labels.
  const dataPort: HistoryDataPort = { buildPayload: () => buildPayload() };
  const historyProvider = new HistoryViewProvider(context.extensionUri, dataPort);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(HistoryViewProvider.viewType, historyProvider, {
      webviewOptions: { retainContextWhenHidden: false },
    }),
  );

  const refreshHistory = (): void => void historyProvider.refresh();

  let lastPhaseShown = '';
  function refreshStatus(now: number): void {
    const phase = tracker.getPhase(now);
    if (phase !== lastPhaseShown) {
      logger.log('phase', { phase, openMs: tracker.currentOpenMs(now) });
      lastPhaseShown = phase;
    }
    if (phase === 'paused') {
      status.showPaused(vscode.l10n.t('Paused'));
      return;
    }
    if (phase === 'grace') {
      // Unfocused out-grace held provisionally: paused look with the idle countdown to the cap.
      const countdown = tracker.getCountdown(now);
      const minutes = countdown ? Math.ceil(countdown.remainingMs / 60_000) : 0;
      status.showPaused(`${vscode.l10n.t('Paused')} (idle -${minutes}m)`);
      return;
    }
    if (phase === 'active') {
      const elapsed = tracker.currentOpenMs(now);
      const { hours, minutes } = hoursMinutes(elapsed);
      // While idle and counting down toward a pause, show the minutes before suspension: "out" for
      // the unfocused grace, "idle" toward a safety cap (focus or debug).
      const countdown = tracker.getCountdown(now);
      let text: string;
      if (!countdown) {
        text = formatClock(elapsed);
      } else {
        const mins = Math.ceil(countdown.remainingMs / 60_000);
        const idle = countdown.reason === 'focus-cap' || countdown.reason === 'debug-cap';
        text = idle
          ? vscode.l10n.t('{session} (idle -{minutes}m)', { session: formatClock(elapsed), minutes: mins })
          : vscode.l10n.t('{session} (out -{minutes}m)', { session: formatClock(elapsed), minutes: mins });
      }
      status.showRunning(text, vscode.l10n.t('Session: {hours}h {minutes}m', { hours, minutes }));
      return;
    }
    if (phase === 'pending') {
      status.showPending(vscode.l10n.t('Awaiting confirmation'));
      return;
    }
    status.showIdle();
  }

  // Attribute time to the folder of the active file. On a real folder change, flush the open
  // interval (committed under the OLD project) before switching, then watch the new project.
  async function setProject(folderUri: vscode.Uri): Promise<void> {
    const id = projectIdFromFsPath(folderUri.fsPath);
    if (id === currentProjectId) return;
    tracker.flush(Date.now()); // emits under the still-current (old) project id
    currentProjectId = id;
    currentFolder = folderUri;
    await storage.ensureDir(id);
    await storage.recoverOrphanMarkers(id, Date.now(), RECOVERY_STALE_MS);
    watcher?.dispose();
    watcher = storage.watch(id, refreshHistory);
    refreshStatus(Date.now());
    refreshHistory();
  }

  // Committed intervals are written under the project active at emit time.
  tracker.onIntervalClosed((iv) => {
    logger.log('interval', { start: iv.start, end: iv.end, ms: iv.end - iv.start, project: currentProjectId });
    const pid = currentProjectId;
    if (!pid) return;
    void storage.appendInterval(pid, iv).then(refreshHistory);
  });

  // Log which silence limit paused the session and by how much.
  const toMin = (ms: number): number => Math.round((ms / 60_000) * 10) / 10;
  tracker.onPaused((info) => {
    logger.log('pause', {
      reason: info.reason, // inactivity | background-timeout | focus-cap | debug-cap
      capped: info.capped, // a safety cap: deducted, not counted
      idleMinutes: toMin(info.silentMs),
      thresholdMinutes: toMin(info.thresholdMs),
      deductedMinutes: toMin(info.deductedMs),
    });
  });

  // Surface discarded-as-noise sessions in the log, so a vanished short session stays explainable.
  tracker.onSessionDiscarded((info) => {
    logger.log('discard', {
      reason: 'short-session',
      seconds: Math.round(info.ms / 1000),
      thresholdMinutes: toMin(info.thresholdMs),
    });
  });

  // Log when a silence limit begins counting down toward a pause (activity just stopped).
  tracker.onCountdownStarted((info) => {
    logger.log('countdown', {
      reason: info.reason,
      thresholdMinutes: toMin(info.thresholdMs),
      pausesInMinutes: toMin(info.remainingMs),
    });
  });

  // Single funnel for advancing the tracker's clock. A tick landing far past the cadence means the
  // host was suspended (sleep / closed lid) while the timers were frozen: close the open session at
  // the last live instant (flush keeps presence) so the slept span is not counted, then tick now.
  function advance(now: number): void {
    if (lastTickAt !== 0 && now - lastTickAt > SUSPEND_GAP_MS) {
      logger.log('suspend', { gapMinutes: toMin(now - lastTickAt) });
      tracker.flush(lastTickAt);
    }
    lastTickAt = now;
    tracker.tick(now);
  }

  registerSignals(context, {
    onActivity: (now, kind) => {
      // Always record the activity instant (keeps the idle timer exact), but coalesce the
      // tick/status/log work to at most once per second. One keystroke fires edit + selection +
      // scroll together, so without this the log and the status bar churn three times per key.
      tracker.recordActivity(now);
      if (now - lastActivityTickAt < 1000) return;
      lastActivityTickAt = now;
      logger.log('activity', { kind });
      advance(now);
      refreshStatus(now);
    },
    onPresence: (focused, now) => {
      logger.log('presence', { focused });
      tracker.setPresence(focused, now);
      advance(now);
      refreshStatus(now);
    },
    onDebugActive: (active) => {
      logger.log('debug', { active });
      tracker.setDebugActive(active);
      const now = Date.now();
      advance(now);
      refreshStatus(now);
    },
    onProcessRunning: (running) => {
      logger.log('process', { running });
      tracker.setTerminalRunning(running);
      const now = Date.now();
      advance(now);
      refreshStatus(now);
    },
    onActiveFolder: (folder) => {
      if (folder) void setProject(folder);
    },
  });

  // Commands.
  context.subscriptions.push(
    vscode.commands.registerCommand('timeTracking.openHistory', () =>
      vscode.commands.executeCommand('timeTracking.historyView.focus'),
    ),
    // Status bar click. Only an active (counting) session pauses on click; every other state
    // (no tracking, paused, awaiting confirmation) treats the click as a deliberate work signal
    // and starts tracking now.
    vscode.commands.registerCommand('timeTracking.toggle', () => {
      const now = Date.now();
      advance(now); // resolve any pending suspend so a slept session is not paused-and-counted here
      if (tracker.getPhase(now) === 'active') {
        tracker.pause(now);
        if (currentProjectId) void storage.writeOpenMarker(currentProjectId, null, now);
      } else {
        tracker.recordActivity(now); // start tracking from rest, pending, or pause
      }
      refreshStatus(now);
      refreshHistory();
    }),
    vscode.commands.registerCommand('timeTracking.pause', () => {
      const now = Date.now();
      advance(now); // close any slept span first, so the pause does not count it
      tracker.pause(now);
      if (currentProjectId) void storage.writeOpenMarker(currentProjectId, null, now);
      refreshStatus(now);
      refreshHistory();
    }),
    vscode.commands.registerCommand('timeTracking.resume', () => {
      tracker.resume();
      advance(Date.now());
      refreshStatus(Date.now());
    }),
    vscode.commands.registerCommand('timeTracking.ignoreSession', () => {
      tracker.ignoreCurrentSession();
      if (currentProjectId) void storage.writeOpenMarker(currentProjectId, null, Date.now());
      refreshStatus(Date.now());
      refreshHistory();
    }),
    vscode.commands.registerCommand('timeTracking.showLog', () => logger.show()),
  );

  // React to settings changes without a reload.
  context.subscriptions.push(
    onConfigChange((cfg) => {
      tracker.setConfig({
        idleThresholdMs: cfg.idleThresholdMs,
        backgroundTimeoutMs: cfg.backgroundTimeoutMs,
        focusCapMs: cfg.focusCapMs,
        debugIdleCapMs: cfg.debugIdleCapMs,
        minSessionMs: cfg.minSessionMs,
      });
      gitEmail = cfg.gitUserEmail;
      fontSizePx = cfg.fontSizePx;
      logger.setEnabled(cfg.debugLogging);
      commitCounts?.clear(); // the configured email feeds the counts; git state won't signal its change
      refreshHistory();
    }),
  );

  // Periodic tick (idle + suspend detection) and checkpoint (crash-recovery marker).
  const tickTimer = setInterval(() => {
    const now = Date.now();
    advance(now);
    refreshStatus(now);
  }, TICK_MS);
  const checkpointTimer = setInterval(() => {
    const now = Date.now();
    advance(now);
    if (!currentProjectId) return;
    void storage.writeOpenMarker(currentProjectId, tracker.getOpenInterval(now), now);
  }, CHECKPOINT_MS);
  context.subscriptions.push({
    dispose: () => {
      clearInterval(tickTimer);
      clearInterval(checkpointTimer);
    },
  });

  // Build the formatted payload for the webview (empty when no project is active).
  async function buildPayload(): Promise<HistoryPayload> {
    const strings = historyStrings();
    if (!currentProjectId) {
      return {
        trendSvg: '',
        heatmapSvg: '',
        months: { currentLabel: formatClock(0), previousLabel: formatClock(0), variationText: '', variationDir: 'na' },
        days: [],
        strings,
        todayHours: 0,
        fontSizePx,
      };
    }

    const now = new Date();
    // Only read what the charts and badges actually cover, not the whole history.
    const sinceMs = historyWindowStartMs(now.getTime());
    const tagged = await storage.readAllTagged(currentProjectId, sinceMs);
    let commits: Record<string, number> = {};
    if (commitCounts && currentFolder) {
      commits = await commitCounts.byDay(currentFolder, gitEmail, sinceMs).catch(() => ({}));
    }

    const model = buildHistoryModel(tagged, commits, now.getTime());

    const pct = model.months.previousVariationPct;
    const rounded = pct === null ? 0 : Math.round(pct);
    const variationDir: HistoryPayload['months']['variationDir'] =
      pct === null ? 'na' : rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'flat';
    // Arrow + sign so the meaning survives without color. Shown only when there is a real
    // difference: nothing if equal (0%) or there is no prior month to compare.
    const arrow = variationDir === 'up' ? '▲ ' : variationDir === 'down' ? '▼ ' : '';
    const variationText = pct === null || rounded === 0 ? '' : `${arrow}${rounded > 0 ? '+' : ''}${rounded}%`;

    const todayKey = dayKeyLocal(now.getTime());
    const today = model.days.find((d) => d.date === todayKey);

    return {
      trendSvg: model.trendSvg,
      heatmapSvg: model.heatmapSvg,
      months: {
        currentLabel: formatClock(model.months.currentMs),
        previousLabel: formatClock(model.months.previousMs),
        variationText,
        variationDir,
      },
      // Last 14 days, newest first.
      days: model.days
        .slice(-14)
        .reverse()
        .map((d) => ({
          date: d.date,
          label: dayLabel(d.date),
          hoursLabel: formatClock(d.seconds * 1000),
          commits: d.commits,
          // One sub-line listing each session's ranges when several sessions worked that day.
          windowsLabel:
            d.windows.length > 1
              ? d.windows
                  .map((w, i) => `${strings.session} ${i + 1}: ${w.ranges.map((r) => `${hhmm(r.start)}-${hhmm(r.end)}`).join(', ')}`)
                  .join(' · ')
              : undefined,
        })),
      strings,
      todayHours: today ? today.seconds / 3600 : 0,
      fontSizePx,
    };
  }

  // Initial project + crash recovery + git, then first render.
  const initialFolder = activeFolderUri();
  if (initialFolder) await setProject(initialFolder);
  void getGitApi().then((api) => {
    if (!api) return;
    commitCounts = new CommitCounts(api);
    context.subscriptions.push(commitCounts);
    refreshHistory();
  });
  refreshStatus(Date.now());

  onDeactivate = async () => {
    watcher?.dispose();
    tracker.flush(Date.now());
    if (currentProjectId) await storage.writeOpenMarker(currentProjectId, null, Date.now());
  };
}

export async function deactivate(): Promise<void> {
  if (onDeactivate) await onDeactivate();
}

function activeFolderUri(): vscode.Uri | undefined {
  const fromEditor = vscode.window.activeTextEditor?.document.uri;
  if (fromEditor) {
    const folder = vscode.workspace.getWorkspaceFolder(fromEditor);
    if (folder) return folder.uri;
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

function dayLabel(compact: string): string {
  const date = new Date(Number(compact.slice(0, 4)), Number(compact.slice(4, 6)) - 1, Number(compact.slice(6, 8)));
  // Localized short date, e.g. "Jun 16" or "16 juin", via the editor display language.
  return new Intl.DateTimeFormat(vscode.env.language, { month: 'short', day: 'numeric' }).format(date);
}

function hhmm(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function historyStrings(): Record<string, string> {
  return {
    history: vscode.l10n.t('History'),
    refresh: vscode.l10n.t('Refresh'),
    openSettings: vscode.l10n.t('Open settings'),
    thisMonth: vscode.l10n.t('This month'),
    lastMonth: vscode.l10n.t('Last month'),
    commitsShort: vscode.l10n.t('commits'),
    session: vscode.l10n.t('Session'),
    trend: vscode.l10n.t('Trend'),
    calendar: vscode.l10n.t('Calendar'),
    days: vscode.l10n.t('Days'),
    less: vscode.l10n.t('Less'),
    more: vscode.l10n.t('More'),
    empty: vscode.l10n.t('No tracking data yet.'),
    hoursToday: vscode.l10n.t('{count} hours tracked today'),
  };
}
