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
// Editor interactions (edit/selection/scroll/navigation) are gated on window focus: an unfocused
// window cannot receive genuine typing, clicking or scrolling, yet events like visible-ranges still
// fire from layout reflows (e.g. windows shuffled across screens when a monitor is plugged or
// unplugged), which would otherwise register as a phantom scroll. Background work (filesystem,
// tasks, terminal) is NOT gated: writing files or running a build legitimately happens unfocused.
import * as vscode from 'vscode';

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
  onPresence(focused: boolean, now: number): void;
  onDebugActive(active: boolean): void;
  onProcessRunning(running: boolean): void;
  onActiveFolder(folder: vscode.Uri | undefined): void;
}

function folderOf(uri: vscode.Uri | undefined): vscode.Uri | undefined {
  if (!uri) return undefined;
  return vscode.workspace.getWorkspaceFolder(uri)?.uri;
}

function activeFolder(): vscode.Uri | undefined {
  return folderOf(vscode.window.activeTextEditor?.document.uri);
}

export function registerSignals(context: vscode.ExtensionContext, sinks: SignalSinks): void {
  const now = (): number => Date.now();

  // An editor interaction is only genuine when the window is focused (see the file header). When it
  // is not, the event is a layout reflow or other side effect, not real work, so it is dropped.
  const editorActivity = (kind: ActivityKind): void => {
    if (!vscode.window.state.focused) return;
    sinks.onActivity(now(), kind);
  };

  // Real editing happens in on-disk files and untitled (unsaved) buffers. Every other scheme
  // (output/log panels, debug repl, SCM input, settings UI, search editor, …) is machinery, not
  // user work, so its edits/selection/scroll are not activity.
  const isEditableDoc = (uri: vscode.Uri): boolean => uri.scheme === 'file' || uri.scheme === 'untitled';

  // Foreground + edit/selection/scroll/navigation.
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((state) => sinks.onPresence(state.focused, now())),
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

  // Terminal shell integration is 1.93+. Feature-gate so older VSCodium builds still load.
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
