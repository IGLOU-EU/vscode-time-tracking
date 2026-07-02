// Minimal subset of the built-in git extension API (`vscode.git`), vendored here because the
// extension does not ship npm types. Source:
// https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts
import type { Uri, Event } from 'vscode';

export interface GitExtension {
  readonly enabled: boolean;
  getAPI(version: 1): API;
}

export type APIState = 'uninitialized' | 'initialized';

export interface API {
  readonly state: APIState;
  readonly onDidChangeState: Event<APIState>;
  readonly repositories: Repository[];
  getRepository(uri: Uri): Repository | null;
  readonly onDidOpenRepository: Event<Repository>;
  readonly onDidCloseRepository: Event<Repository>;
}

export interface Commit {
  readonly hash: string;
  readonly message: string;
  readonly parents: string[];
  readonly authorDate?: Date;
  readonly authorName?: string;
  readonly authorEmail?: string;
}

export interface LogOptions {
  readonly maxEntries?: number;
}

export interface RepositoryState {
  readonly onDidChange: Event<void>;
}

export interface Repository {
  readonly rootUri: Uri;
  readonly state: RepositoryState;
  log(options?: LogOptions): Promise<Commit[]>;
  /** Reads the repository-local config scope only (`git config --get --local`). */
  getConfig(key: string): Promise<string>;
  /** Reads the global config scope (`git config --global --get`). */
  getGlobalConfig(key: string): Promise<string>;
}
