// Pure core: tolerant JSONL reading/writing. NO 'vscode' import.
// Storage is append-only, one JSON line per record. Parsing must survive
// a truncated last line (editor crash mid-write) and a corrupted line.

import type { Interval } from './intervals';

export const SCHEMA_VERSION = 1;

/** Closed interval as persisted on disk. A single writer (windowId) per file. */
export interface StoredInterval {
  /** Schema version, for future migrations. */
  readonly v: number;
  /** Identifier of the window that owns the file. */
  readonly windowId: string;
  readonly start: number;
  readonly end: number;
}

/** Parse JSONL text into objects, silently skipping any unparsable line. */
export function parseJsonl(text: string): unknown[] {
  const out: unknown[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.length === 0) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // truncated or corrupted line: ignore it
    }
  }
  return out;
}

/** Serialize an object into a single JSONL line (with trailing newline). */
export function serializeLine(obj: unknown): string {
  return `${JSON.stringify(obj)}\n`;
}

/** Serialize a list of objects into JSONL text. */
export function serializeJsonl(objs: readonly unknown[]): string {
  return objs.map(serializeLine).join('');
}

/** Type guard: is the object a valid StoredInterval (fields present, correct types, consistent ordering). */
export function isStoredInterval(x: unknown): x is StoredInterval {
  if (typeof x !== 'object' || x === null) return false;
  const r = x as Record<string, unknown>;
  if (typeof r.v !== 'number') return false;
  if (typeof r.windowId !== 'string') return false;
  if (typeof r.start !== 'number' || typeof r.end !== 'number') return false;
  if (r.end < r.start) return false;
  return true;
}

/** Parse JSONL text keeping only valid intervals. */
export function parseIntervals(text: string): StoredInterval[] {
  return parseJsonl(text).filter(isStoredInterval);
}

/** Stamp a raw interval with the schema version and the owning window. */
export function toStoredInterval(windowId: string, iv: Interval): StoredInterval {
  return { v: SCHEMA_VERSION, windowId, start: iv.start, end: iv.end };
}
