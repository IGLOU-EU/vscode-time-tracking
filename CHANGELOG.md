# Changelog

All notable changes to this extension are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.0.1] - 2026-06-17

### Changed

- History panel performance. Opening or refreshing the panel no longer reloads and re-parses the
  entire history every time. Reads are bounded to the window the charts and badges actually show
  (about 16 weeks), past-day files are parsed once and cached, and per-day commit counts are cached
  per repository and refreshed only when the repository changes. Keeping the panel open (which
  rebuilds about once a minute) stays responsive regardless of how many years have accumulated. No
  change to what is tracked or displayed.

### Tooling

- Vitest benchmark for the history read path (`npm run bench`).
- Integration tests for the storage adapter in a real Extension Host: JSONL round-trip, settled-day
  parse cache, window bound, and watcher-driven cache eviction.

## [1.0.0] - 2026-06-17

### Added

- Automatic, focus-aware time tracking, per window and per project, with no manual start.
- Activity model: a real action (edit, selection, scroll, navigation, task, or any workspace
  file write, including a plugin like Claude Code, a build, or a folder creation) starts and
  sustains a session. Window focus keeps an active session alive (thinking and reading count)
  and presence alone never counts until a real action. The real mouse is not used (no API).
- Pause model: while focused, no inactivity pause, only a focus safety cap; unfocused, an
  inactivity grace from the moment focus is lost; a running process uses a background timeout;
  a debug session holds tracking open. Timeouts (inactivity, background) are counted as work;
  safety caps (focus, debug) trim the idle tail so a forgotten session is not counted.
- Per-window autonomous trackers. Time from multiple windows on the same project is merged
  (interval union) at read time, so overlapping windows are never double-counted.
- Day boundary at local midnight: sessions crossing midnight are split.
- Status bar item: session time (with the time left before suspension during an idle
  countdown), "awaiting confirmation", "paused", or "no tracking", color-coded. Click toggles
  pause and resume.
- History view (activity bar): a 24-hour activity-density curve (a sliding-window activity rate,
  so a long focus block is a plateau, pomodoro shows bumps, and breaks fall toward zero), calendar
  heatmap (each cell's tooltip shows the day's hours and, when present, the commit count), your git
  commits per day (by `user.email`), current/previous month totals with the month-over-month
  variation, and a per-window breakdown. Charts are inline SVG, themed, and work offline.
- Commands: open history, toggle pause, pause, resume, ignore current session, show log.
- Settings: inactivity threshold, background process timeout, focused idle cap, debug idle cap,
  git user email, debug logging.
- Optional debug logging to an output channel and a log file (signals, decisions, intervals).
- Crash recovery via a per-window open-interval marker.
- Internationalisation: English and French (`package.nls.*` and `vscode.l10n`).
- Storage under `globalStorageUri`, append-only JSONL, one file per window per day.

### Tooling

- esbuild bundling, strict TypeScript, ESLint, Vitest for the pure core (TDD),
  and `@vscode/test-cli` smoke tests in a real Extension Host.
