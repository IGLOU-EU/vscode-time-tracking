// Integration tests for the storage adapter against the real vscode.workspace.fs, inside the
// Extension Host (@vscode/test-cli, Mocha tdd). These cover what the pure-core unit tests cannot:
// the JSONL round-trip on disk, the settled-day parse cache, the window bound, and the watcher
// eviction. The storage root lives inside the test workspace folder so the file watcher reliably
// receives change events.
import * as assert from 'node:assert';
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { StorageAdapter } from '../adapters/storage';
import { dayKeyLocal } from '../core/aggregate';
import { serializeLine, toStoredInterval } from '../core/jsonl';

const PROJECT = 'proj';
const HOUR = 3_600_000;

// A timestamp N days ago at local noon: noon dodges any midnight/DST edge when we subtract a day.
function daysAgo(n: number): number {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d.getTime();
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

suite('StorageAdapter (real fs)', () => {
  let root: vscode.Uri;
  let seq = 0;

  const makeAdapter = (windowId = 'w1'): StorageAdapter => new StorageAdapter(root, windowId);
  const fileFor = (start: number, windowId: string): string =>
    path.join(root.fsPath, PROJECT, `${dayKeyLocal(start)}.${windowId}.jsonl`);

  setup(() => {
    const ws = vscode.workspace.workspaceFolders?.[0];
    assert.ok(ws, 'expected a workspace folder from .vscode-test.mjs');
    root = vscode.Uri.joinPath(ws.uri, `.tt-store-${Date.now()}-${seq++}`);
  });

  teardown(async () => {
    await fsp.rm(root.fsPath, { recursive: true, force: true }).catch(() => undefined);
  });

  test('round-trips an appended interval through readAllTagged', async () => {
    const a = makeAdapter('w1');
    await a.ensureDir(PROJECT);
    const start = daysAgo(2);
    await a.appendInterval(PROJECT, { start, end: start + HOUR });

    const read = await a.readAllTagged(PROJECT);
    assert.strictEqual(read.length, 1);
    assert.deepStrictEqual(read[0], { windowId: 'w1', start, end: start + HOUR });
  });

  test('serves settled-day files from cache (an external append is not seen)', async () => {
    const a = makeAdapter('w1');
    await a.ensureDir(PROJECT);
    const start = daysAgo(2);
    await a.appendInterval(PROJECT, { start, end: start + HOUR });
    assert.strictEqual((await a.readAllTagged(PROJECT)).length, 1); // parses and caches the file

    // Append straight to disk, bypassing the adapter (no watcher is wired in this test).
    await fsp.appendFile(
      fileFor(start, 'w1'),
      serializeLine(toStoredInterval('w1', { start: start + 2 * HOUR, end: start + 3 * HOUR })),
    );

    // Same adapter: cache hit, the new line is not observed.
    assert.strictEqual((await a.readAllTagged(PROJECT)).length, 1);
    // A fresh adapter has an empty cache and reads both lines, proving the append really landed.
    assert.strictEqual((await makeAdapter('w1').readAllTagged(PROJECT)).length, 2);
  });

  test('skips files whose day is older than the rendered window', async () => {
    const a = makeAdapter('w1');
    await a.ensureDir(PROJECT);
    const old = daysAgo(200);
    const recent = daysAgo(2);
    await a.appendInterval(PROJECT, { start: old, end: old + HOUR });
    await a.appendInterval(PROJECT, { start: recent, end: recent + HOUR });

    const read = await a.readAllTagged(PROJECT, daysAgo(100));
    assert.strictEqual(read.length, 1);
    assert.strictEqual(read[0].start, recent);
  });

  test('keeps the day just before the window start (one-day slack), drops the one before that', async () => {
    const a = makeAdapter('w1');
    await a.ensureDir(PROJECT);
    const boundary = daysAgo(101); // one day before the window start -> kept by the slack
    const tooOld = daysAgo(102); // two days before -> dropped
    await a.appendInterval(PROJECT, { start: boundary, end: boundary + HOUR });
    await a.appendInterval(PROJECT, { start: tooOld, end: tooOld + HOUR });

    const read = await a.readAllTagged(PROJECT, daysAgo(100));
    assert.strictEqual(read.length, 1);
    assert.strictEqual(read[0].start, boundary);
  });

  test('evicts a changed file from the cache when the watcher fires', async () => {
    const a = makeAdapter('w1');
    await a.ensureDir(PROJECT);
    const start = daysAgo(2);
    await a.appendInterval(PROJECT, { start, end: start + HOUR });
    assert.strictEqual((await a.readAllTagged(PROJECT)).length, 1); // cached

    let fire!: () => void;
    const changed = new Promise<void>((resolve) => {
      fire = resolve;
    });
    const watcher = a.watch(PROJECT, () => fire());
    try {
      await delay(300); // let the file watcher arm before we touch the file
      await fsp.appendFile(
        fileFor(start, 'w1'),
        serializeLine(toStoredInterval('w1', { start: start + 2 * HOUR, end: start + 3 * HOUR })),
      );
      await withTimeout(changed, 10_000, 'file watcher never fired for the changed file');

      // The watcher evicted the cache entry, so the re-read now sees both lines.
      assert.strictEqual((await a.readAllTagged(PROJECT)).length, 2);
    } finally {
      watcher.dispose();
    }
  });
});
