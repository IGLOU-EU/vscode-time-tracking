// Adapter: translate VSCode events into normalized tracking signals. No duration logic here.
// Activity = edits, selection, scroll, navigation, returning focus, AND filesystem changes in
// the workspace. Editor interactions count in on-disk files and untitled (unsaved) buffers; other
// document schemes (output/log panels, debug repl, SCM input, settings UI) are machinery, not work. The filesystem watcher is what makes work outside the editor count: a terminal
// command, a folder creation, or a plugin like Claude Code writing files directly to disk (which
// never fires onDidChangeTextDocument). Continuous signals = active debug session, running tasks,
// running terminal shell commands (1.93+, feature-gated). Losing focus is NOT a pause: working in
// a browser, a database, or documentation is still work, so the core's idle timeout governs.
// The real mouse is not exposed by the API. Each activity carries a `kind` so the debug log shows
// what triggered it.
//
// Editor interactions (edit/selection/scroll/navigation) only count while the window is focused: an
// unfocused window cannot receive genuine input, so those events are spurious. Background work
// (filesystem, tasks, terminal) is not gated, because it legitimately happens while unfocused.
// Focus is not enough for a scroll that would START a session though: a focused window being
// resized or moved between monitors re-emits its visible ranges, so a lone scroll waits for a
// confirmation (see core/scroll-filter). Inside a running session every scroll counts.
import * as vscode from 'vscode';

import { createScrollFilter } from '../core/scroll-filter';
import { FOCUS_SETTLE_MS } from '../core/tracker';

export type ActivityKind =
  | 'edit'
  | 'selection'
  | 'scroll'
  | 'navigation'
  | 'task'
  | 'save'
  | 'fs:create'
  | 'fs:change'
  | 'fs:delete'
  | 'file:create'
  | 'file:delete'
  | 'file:rename';

export interface SignalSinks {
  onActivity(now: number, kind: ActivityKind): void;
  /** A scroll held back as unconfirmed, for the debug log only. Never tracked as work. */
  onActivityIgnored(now: number, kind: ActivityKind): void;
  onPresence(focused: boolean, now: number): void;
  onDebugActive(active: boolean): void;
  onProcessRunning(running: boolean): void;
  onActiveFolder(folder: vscode.Uri | undefined): void;
  /** Whether a session is already running, which is what the scroll confirmation hinges on. */
  isSessionActive(): boolean;
}

function folderOf(uri: vscode.Uri | undefined): vscode.Uri | undefined {
  if (!uri) return undefined;
  return vscode.workspace.getWorkspaceFolder(uri)?.uri;
}

function activeFolder(): vscode.Uri | undefined {
  return folderOf(vscode.window.activeTextEditor?.document.uri);
}

// A scroll gesture keeps firing, a relayout fires once. Scrolls under a second apart come from the
// same relayout; past five seconds a scroll is on its own again and needs a new confirmation.
const SCROLL_BURST_MS = 1_000;
const SCROLL_CONFIRM_MS = 5_000;

export function registerSignals(context: vscode.ExtensionContext, sinks: SignalSinks): void {
  const now = (): number => Date.now();
  const scrollFilter = createScrollFilter({ burstMs: SCROLL_BURST_MS, confirmMs: SCROLL_CONFIRM_MS });
  // Never accept a scroll from an unfocused window, whatever the event says: NEGATIVE_INFINITY
  // stands for "not focused", so the settle test below fails on its own.
  let focusedSince = vscode.window.state.focused ? now() : Number.NEGATIVE_INFINITY;
  const focusSettled = (at: number): boolean => at - focusedSince >= FOCUS_SETTLE_MS;

  // A scroll is the one signal the window can produce without anyone touching it, so it is the one
  // signal that has to prove itself. A window that just took focus is still laying itself out, and
  // crossing it on the way elsewhere is not work: nothing it scrolls in that moment counts. From
  // rest, a lone scroll must also be confirmed, otherwise it would start counting time nobody
  // worked. Inside a running session it is taken as it comes: a slow review read (scroll, think,
  // scroll) cannot be told apart from a phantom, and dropping it would trim real work.
  const acceptScroll = (at: number): boolean => {
    if (!focusSettled(at)) return false;
    return sinks.isSessionActive() || scrollFilter.accepts(at);
  };

  // Editor events are only genuine while focused (see the file header). Otherwise they are spurious.
  const editorActivity = (kind: ActivityKind): void => {
    if (!vscode.window.state.focused) return;
    const at = now();
    if (kind === 'scroll' && !acceptScroll(at)) {
      sinks.onActivityIgnored(at, kind);
      return;
    }
    sinks.onActivity(at, kind);
  };

  // Real editing happens in on-disk files and untitled (unsaved) buffers. Every other scheme
  // (output/log panels, debug repl, SCM input, settings UI, search editor, …) is machinery, not
  // user work, so its edits/selection/scroll are not activity.
  const isEditableDoc = (uri: vscode.Uri): boolean => uri.scheme === 'file' || uri.scheme === 'untitled';

  // Foreground + edit/selection/scroll/navigation.
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((state) => {
      const at = now();
      focusedSince = state.focused ? at : Number.NEGATIVE_INFINITY;
      sinks.onPresence(state.focused, at);
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      const active = vscode.window.activeTextEditor;
      if (!active || e.document !== active.document) return; // ignore non-visible docs (logs, SCM)
      if (!isEditableDoc(e.document.uri)) return;
      if (e.contentChanges.length === 0) return;
      editorActivity('edit');
    }),
    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (!isEditableDoc(e.textEditor.document.uri)) return;
      editorActivity('selection');
    }),
    // Scrolling counts as activity: reading code is work even without typing.
    vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
      if (!isEditableDoc(e.textEditor.document.uri)) return;
      editorActivity('scroll');
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      sinks.onActiveFolder(folderOf(editor?.document.uri)); // project tracking is not focus-gated
      if (editor) editorActivity('navigation');
    }),
  );

  // Debug sessions (compound configs can overlap, so count with an integer).
  let debugCount = 0;
  context.subscriptions.push(
    vscode.debug.onDidStartDebugSession(() => {
      debugCount += 1;
      sinks.onDebugActive(debugCount > 0);
    }),
    vscode.debug.onDidTerminateDebugSession(() => {
      debugCount = Math.max(0, debugCount - 1);
      sinks.onDebugActive(debugCount > 0);
    }),
  );
  sinks.onDebugActive(vscode.debug.activeDebugSession !== undefined); // cold start

  // Running processes: tasks + terminal shell executions share one running counter.
  let processCount = 0;
  const bumpProcess = (delta: number): void => {
    processCount = Math.max(0, processCount + delta);
    sinks.onProcessRunning(processCount > 0);
  };
  context.subscriptions.push(
    vscode.tasks.onDidStartTaskProcess(() => {
      sinks.onActivity(now(), 'task');
      bumpProcess(1);
    }),
    vscode.tasks.onDidEndTaskProcess(() => bumpProcess(-1)),
  );

  // The terminal shell execution events are 1.93+, above the engines.vscode floor, so they are
  // missing from the pinned types and undefined on an older editor: detect them before use. Without
  // them a terminal command goes unseen as a running process, and everything else still works. They
  // fire only in a terminal where shell integration is active.
  // https://code.visualstudio.com/updates/v1_93#_terminal-shell-integration-api
  const win = vscode.window as unknown as {
    onDidStartTerminalShellExecution?: vscode.Event<unknown>;
    onDidEndTerminalShellExecution?: vscode.Event<unknown>;
  };
  if (win.onDidStartTerminalShellExecution && win.onDidEndTerminalShellExecution) {
    context.subscriptions.push(
      win.onDidStartTerminalShellExecution(() => bumpProcess(1)),
      win.onDidEndTerminalShellExecution(() => bumpProcess(-1)),
    );
  }

  // Filesystem activity in the workspace: external writes (Claude Code or any plugin writing
  // files, builds, terminal commands creating files) and folder creation. None of these fire
  // onDidChangeTextDocument. Throttled, because a build can touch many files at once.
  let lastFsAt = 0;
  const onFs = (uri: vscode.Uri, kind: ActivityKind): void => {
    if (uri.scheme !== 'file') return;
    const t = now();
    if (t - lastFsAt < 1000) return; // collapse bursts to at most one signal per second
    lastFsAt = t;
    sinks.onActivity(t, kind);
  };
  const fsWatcher = vscode.workspace.createFileSystemWatcher('**/*');
  context.subscriptions.push(
    fsWatcher,
    fsWatcher.onDidCreate((uri) => onFs(uri, 'fs:create')),
    fsWatcher.onDidChange((uri) => onFs(uri, 'fs:change')),
    fsWatcher.onDidDelete((uri) => onFs(uri, 'fs:delete')),
    vscode.workspace.onDidCreateFiles(() => sinks.onActivity(now(), 'file:create')),
    vscode.workspace.onDidDeleteFiles(() => sinks.onActivity(now(), 'file:delete')),
    vscode.workspace.onDidRenameFiles(() => sinks.onActivity(now(), 'file:rename')),
    vscode.workspace.onDidSaveTextDocument(() => sinks.onActivity(now(), 'save')),
  );

  // Cold-start snapshot.
  sinks.onPresence(vscode.window.state.focused, now());
  sinks.onActiveFolder(activeFolder());
}
