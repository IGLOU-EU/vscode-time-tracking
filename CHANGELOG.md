# Changelog

All notable changes to this extension are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Clicking last month's total in the History panel opens a page with the project's total tracked time and the total of every month worked.
- The add time, export, refresh and settings buttons of the History panel are now commands, shown in the view's title bar like the actions of the built-in views. They are also in the Command Palette under Time Tracking, so each can be bound to a key. Run from there, Add Time and Export Timesheet open the view, then their form.

### Changed

- The extension now installs on VSCode and VSCodium 1.82 and later, instead of 1.93. The README claimed that older editors were supported, yet they refused to install it. Before 1.93, a command running in the integrated terminal is not seen as a running process, and everything else works the same.

### Fixed

- The badge that shows today's tracked hours on the History view's activity bar icon now stays up to date while the view is hidden, which is when you see it. It kept the count of the last time the view was on screen. As before, it appears once the view has been shown in the window.
- A day you expand in the History list now stays expanded when the panel refreshes, every minute during a session, and when you come back to a hidden view. It folded back to one line.
- A `fontSize` of `0` now sizes the History panel from the editor font size, as its description says, and follows it when it changes. It used the workbench size, a fixed 13 px.
- The History calendar now names its months and weekdays in the editor's display language, and its day tooltips write the hours and the commit count in that language too. They were always in English.
- The History day list agrees the commit count with its number ("1 commit", and "0 commit" in French) instead of always writing "commits".
- The History panel declares the editor's display language instead of English, so a screen reader reads it with the voice of that language.
- A screen reader no longer reads a paused session twice from the status bar ("Paused: Paused"), and it reads a running session with the punctuation of the display language.
- The description of `gitUserEmail` now says that, left empty, it falls back on the global git configuration when the repository sets no email, as it has done since 1.3.0.
- In a multi-root workspace, the settings a folder sets in its own `.vscode/settings.json` now apply while you work in that folder, and moving to a file of another folder switches to that folder's settings. They used to be ignored, so a `projectName` set for one folder never reached its exports.
- A setting written by hand with the wrong type no longer breaks tracking. A word in `inactivityThresholdMinutes` disabled the focus safety cap, so a forgotten window kept counting, and closed the session as soon as the window lost focus. A project name that is not text, or a list written as a single text, kept the extension from starting. Such a value is now replaced by the default, and a number outside its range is brought back to its nearest limit.
- Closing a window no longer risks losing the session it was tracking. The session was saved without waiting while its crash-recovery copy was already being deleted, so an editor shutting down at that moment could lose both. The copy is now deleted only once the session is on disk, and a save that fails is written to the debug log.

### Tooling

- The History page script is now type-checked and linted with the rest of the code, as browser code whose messages must match what the extension accepts. Both checks skipped it, so a mistake in it only showed in a broken panel.
- The CI builds the extension bundle on every push, as the local checks already require.
- The editor API types are pinned to the minimum supported VSCode version, so a call to a newer API fails the type check instead of breaking on older editors.
- The integration tests also run on the minimum supported VSCode version, and a unit test keeps the API types and the README on that version.
- The integration tests also run in a multi-root workspace, where each folder carries its own settings.
- The development Node version in `engines.node` now matches what the build tools require, and npm refuses to install on another one. The extension bundle targets the Node of the oldest supported editor instead.
- `F5` works from a fresh clone: it compiles the extension and runs it on the sample workspace, in a development host with its own profile and the other extensions disabled.
- A unit test checks the French translations against the code and the manifest, so a new or reworded string can no longer stay untranslated unnoticed. It found the two status bar countdowns missing from the French bundle and two leftover translations.

## [1.3.1] - 2026-08-04

### Changed

- Crossing a window no longer rearms its timers. Alt-tabbing through windows, or clicking the
  taskbar icon to reach another one, focuses every window on the way: a forgotten session used to
  get its full safety cap back from that alone. A focus gain now has to last five seconds before
  it counts, and a focus lost sooner is treated as if it never happened. The status bar still
  shows "awaiting confirmation" right away, since it counts nothing.
- A scroll never counts in the five seconds after a window takes focus, session running or not: a
  window that just appeared is still laying itself out, and a scroll is the one signal it can
  produce with nobody touching it. Typing, selecting and navigating still count immediately.

### Fixed

- The short-session threshold (`minSessionMinutes`, 1 min by default) now applies to every way a
  session can end, not only to a hand pause. A false start that ended with a project switch, a
  host suspend, a window closed, a timeout, a safety cap, or a crash recovery used to be written
  as tracked time. The threshold judges the time that would be recorded, so a session held open
  for an hour whose safety cap leaves one minute is discarded too, while a long session split at
  local midnight keeps both of its legs.
- A phantom scroll no longer starts a session. Resizing the window, plugging or unplugging a
  monitor, or toggling a panel makes the editor report a scroll nobody performed, and a focused
  window was enough for it to start counting. From rest, a scroll now starts a session only once
  the gesture continues past a second. Any other action still starts it right away, and inside a
  running session every scroll counts as before, so reading line by line never gets trimmed. When
  debug logging is on, a held-back scroll is written as an `ignored` line.

## [1.3.0] - 2026-07-03

### Added

- The add-time form shows a live hint ("Ends the next day (16h 00m).") as soon as the typed end
  precedes the start, so a swapped start/end no longer stores a huge overnight entry silently.
- The suggested export file name follows the selected month, and a name you customized by hand
  is never overwritten.

### Changed

- A day's sessions are now split by source. A manual entry's reason labels exactly its own time
  span instead of the whole block it touches, and two overlapping windows show as two sessions
  (the overlap counted once, with the earlier window). The listed sessions always sum to the day
  total, and the per-session export matches the panel.
- The exported timesheet no longer includes the in-progress session: a permanent file only
  carries closed time, while the live panel keeps showing the running session.
- The extension no longer rewrites over-long `manualReasons` values into your settings file; the
  32-character cap applies when the list is read and when an entry is saved.
- Exporting a month only reads that month's data instead of re-reading the whole history.

### Fixed

- Exported hours around a manual entry are attributed to the default reason again, instead of
  crediting the whole merged block to the entry's reason.
- A manual entry typed on a DST transition day is stored at the typed wall-clock time (it landed
  one hour off).
- A manual entry saved for a past day now shows up in the panel immediately.
- A failed save or export reports its error in the form instead of leaving the button disabled
  with no message, and a shown validation error disappears as soon as you edit a field.
- Commit counts now resolve your git email from the global git config too (most setups define it
  there only), and a count that failed while git was still starting up is retried instead of
  staying frozen at zero.
- Reasons and paths containing double quotes are no longer cut short by the forms.
- An empty export separator falls back to a comma instead of producing an unparseable file.
- Exporting with an empty file path shows an actionable message instead of the bare field label.
- The five `exportDateFormat` preset descriptions are localized, and the French translations
  regain their accents.

## [1.2.0] - 2026-07-01

### Added

- Add tracked time by hand from the History panel. A new "+" action opens a form where you pick a
  reason (from a configurable preset list or free text), a date, and a start and end time. The
  entry counts exactly like a tracked session and never double counts when it overlaps existing
  time. An entry whose end is earlier than its start is treated as a session crossing midnight.
- Export a month of tracked time to a CSV file. A new export action lets you choose the month
  (only those with data, the previous month by default), the rows (per day grouped by reason, or
  per session), and the output file. The columns, separator, date format, project name and the
  reason given to plain editor time are all configurable in the settings.

### Changed

- The History panel toolbar now uses the native editor icons.

## [1.1.0] - 2026-06-21

### Added

- The History panel now lists each day's work sessions with their time ranges (for example
  "Session 1: 09:00-11:00 · Session 2: 14:00-15:30"). Every day with tracked time shows its
  sessions. Previously the ranges appeared only when several windows had worked the same day.

### Fixed

- Time spent while the computer is asleep is no longer counted. After an OS suspend (sleep or a
  closed lid) the session closes at the last moment before the machine froze, instead of counting
  the whole away period as active time.

## [1.0.2] - 2026-06-18

### Fixed

- Activity bar badge tooltip now shows today's rounded tracked-hours count. Hovering the Time
  Tracking icon previously displayed only "Hours tracked today" without the number shown on the
  badge.

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
