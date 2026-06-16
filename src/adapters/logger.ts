// Adapter: optional debug logging. When enabled (timeTracking.debugLogging), writes timestamped
// lines to the "Time Tracking" output channel AND appends them to a log file in globalStorage,
// so the behavior (signals received, decisions, intervals emitted) can be followed live or read
// back later. Disabled by default and a no-op then, so it costs nothing in normal use.
import * as vscode from 'vscode';
import { appendFile } from 'node:fs/promises';

export interface Logger {
  log(event: string, data?: Record<string, unknown>): void;
  setEnabled(enabled: boolean): void;
  show(): void;
  dispose(): void;
}

export function createLogger(logFile: vscode.Uri, enabled: boolean): Logger {
  const channel = vscode.window.createOutputChannel('Time Tracking');
  let on = enabled;

  const write = (line: string): void => {
    channel.appendLine(line);
    if (logFile.scheme === 'file') {
      void appendFile(logFile.fsPath, `${line}\n`, { encoding: 'utf8' }).catch(() => {
        // logging must never throw into the extension
      });
    }
  };

  return {
    log(event, data) {
      if (!on) return;
      const ts = new Date().toISOString();
      write(data ? `${ts}  ${event}  ${JSON.stringify(data)}` : `${ts}  ${event}`);
    },
    setEnabled(value) {
      on = value;
      if (value) write(`${new Date().toISOString()}  logging enabled`);
    },
    show() {
      channel.show();
    },
    dispose() {
      channel.dispose();
    },
  };
}
