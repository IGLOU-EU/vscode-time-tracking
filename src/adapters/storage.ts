// Adapter: persistence under globalStorageUri. Committed closed intervals go to append-only
// JSONL files, one per window per day. A single provisional "open marker" per window holds the
// in-progress interval for crash recovery. Reads union committed intervals across all windows
// plus their live open markers; the core merges them at read time.
import * as vscode from 'vscode';
import { appendFile } from 'node:fs/promises';
import { dayKeyLocal } from '../core/aggregate';
import { serializeLine, toStoredInterval, parseIntervals } from '../core/jsonl';
import type { Interval } from '../core/intervals';
import type { TaggedInterval } from '../core/history';

const enc = new TextEncoder();
const dec = new TextDecoder();

interface OpenMarker {
  windowId: string;
  start: number;
  end: number;
  lastSeen: number;
}

export class StorageAdapter {
  constructor(
    private readonly root: vscode.Uri,
    private readonly windowId: string,
  ) {}

  private projectDir(projectId: string): vscode.Uri {
    return vscode.Uri.joinPath(this.root, projectId);
  }

  async ensureDir(projectId: string): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.projectDir(projectId));
  }

  async appendInterval(projectId: string, iv: Interval): Promise<void> {
    if (iv.end <= iv.start) return; // nothing to store
    const file = vscode.Uri.joinPath(
      this.projectDir(projectId),
      `${dayKeyLocal(iv.start)}.${this.windowId}.jsonl`,
    );
    await this.append(file, serializeLine(toStoredInterval(this.windowId, iv)));
  }

  async writeOpenMarker(projectId: string, iv: Interval | null, now: number): Promise<void> {
    const file = vscode.Uri.joinPath(this.projectDir(projectId), `${this.windowId}.open.json`);
    if (iv === null) {
      try {
        await vscode.workspace.fs.delete(file);
      } catch {
        // nothing to delete
      }
      return;
    }
    const marker: OpenMarker = { windowId: this.windowId, start: iv.start, end: iv.end, lastSeen: now };
    await vscode.workspace.fs.writeFile(file, enc.encode(JSON.stringify(marker)));
  }

  // Recover orphan markers left by a crashed window: commit their interval, then delete them.
  // Only markers from another window whose lastSeen is older than staleMs are considered orphans.
  async recoverOrphanMarkers(projectId: string, now: number, staleMs: number): Promise<void> {
    const dir = this.projectDir(projectId);
    for (const [name, type] of await this.list(dir)) {
      if (type !== vscode.FileType.File || !name.endsWith('.open.json')) continue;
      const file = vscode.Uri.joinPath(dir, name);
      const marker = await this.readJson<OpenMarker>(file);
      if (!marker || marker.windowId === this.windowId) continue;
      if (now - marker.lastSeen < staleMs) continue; // another live window, leave it alone
      if (marker.end > marker.start) {
        await this.appendInterval(projectId, { start: marker.start, end: marker.end });
      }
      try {
        await vscode.workspace.fs.delete(file);
      } catch {
        // already gone
      }
    }
  }

  // All intervals for a project, tagged with their window: every window's committed JSONL plus
  // every valid open marker. The core merges them (and breaks them down per window) at read time.
  async readAllTagged(projectId: string): Promise<TaggedInterval[]> {
    const dir = this.projectDir(projectId);
    const out: TaggedInterval[] = [];
    for (const [name, type] of await this.list(dir)) {
      if (type !== vscode.FileType.File) continue;
      const file = vscode.Uri.joinPath(dir, name);
      if (name.endsWith('.jsonl')) {
        const bytes = await this.readBytes(file);
        if (!bytes) continue;
        for (const r of parseIntervals(dec.decode(bytes))) {
          out.push({ windowId: r.windowId, start: r.start, end: r.end });
        }
      } else if (name.endsWith('.open.json')) {
        const marker = await this.readJson<OpenMarker>(file);
        if (marker && marker.end > marker.start) {
          out.push({ windowId: marker.windowId, start: marker.start, end: marker.end });
        }
      }
    }
    return out;
  }

  watch(projectId: string, onChanged: () => void): vscode.Disposable {
    const pattern = new vscode.RelativePattern(this.projectDir(projectId), '*');
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const trigger = debounce(onChanged, 400);
    return vscode.Disposable.from(
      watcher,
      watcher.onDidChange(trigger),
      watcher.onDidCreate(trigger),
      watcher.onDidDelete(trigger),
    );
  }

  private async append(file: vscode.Uri, text: string): Promise<void> {
    if (file.scheme === 'file') {
      // O(1) atomic append on desktop.
      await appendFile(file.fsPath, text, { encoding: 'utf8' });
      return;
    }
    // Portable fallback (web/remote): read + concat + write.
    const existing = (await this.readBytes(file)) ?? new Uint8Array(0);
    const add = enc.encode(text);
    const merged = new Uint8Array(existing.length + add.length);
    merged.set(existing, 0);
    merged.set(add, existing.length);
    await vscode.workspace.fs.writeFile(file, merged);
  }

  private async list(dir: vscode.Uri): Promise<[string, vscode.FileType][]> {
    try {
      return await vscode.workspace.fs.readDirectory(dir);
    } catch {
      return [];
    }
  }

  private async readBytes(file: vscode.Uri): Promise<Uint8Array | null> {
    try {
      return await vscode.workspace.fs.readFile(file);
    } catch {
      return null;
    }
  }

  private async readJson<T>(file: vscode.Uri): Promise<T | null> {
    const bytes = await this.readBytes(file);
    if (!bytes) return null;
    try {
      return JSON.parse(dec.decode(bytes)) as T;
    } catch {
      return null;
    }
  }
}

function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}
