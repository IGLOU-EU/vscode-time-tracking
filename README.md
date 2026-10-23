# Time Tracking

A VSCode/VSCodium extension that tracks your working time automatically,
designed so you never have to think about it.

## Screenshot

![The history view: monthly totals with month-over-month variation, a 24-hour activity-density curve, a calendar heatmap, and the per-day list with git commit counts](https://gitlab.com/iglou.eu/vscode-time-tracking/-/raw/main/media/screenshot.png)

## Why

Starting a time tracker by hand means forgetting it half the time, and
by the time you remember, the count is already wrong. This extension
tracks time passively, per window and per project, with no action on
your part.

It was built by a developer with ADHD who genuinely needed it: the
manual "start the timer" step is exactly the kind of thing that never
happens, so the tracker has to be automatic, quiet, and forgiving of
the way a real day actually goes (long focus, pomodoro, interruptions,
stepping away).

## Principles

- **One window = one autonomous tracker.** Two windows open on the same
  project each count on their own. The real worked time is the union of
  both (window 1 from 14:00 to 16:00 plus window 2 from 14:30 to 17:00
  gives 3 hours), and the history lists them as separate sessions with
  the overlap counted once, so the sessions always sum to the day total.
- **One project = one folder.** In multi-folder workspaces, time is
  attributed to the folder of the active file.
- **Automatic, focus-aware tracking.** Counting starts on a real action
  (typing, scrolling, navigating, a file write, a running process) and
  keeps going while the window is focused, so thinking and reading
  count. Leaving the editor does not stop it: a configurable inactivity
  grace covers work in a browser, a database, or documentation. A long
  focus safety cap guards against a forgotten window, and that idle tail
  is trimmed off rather than counted.
- **Split by day** at local midnight.

## Features

- Status bar indicator (bottom right): current session time,
  "awaiting confirmation", "paused", or "no tracking". During an idle
  countdown it shows the time left before suspension. Click to pause or
  resume.
- History view (activity bar icon): a 24-hour activity-density curve,
  calendar heatmap (hover a day for its hours and commit count), your git
  commits per day, monthly totals with variation, and a per-window
  breakdown. Click last month's total to see the project's total and
  every month's.
- Manual time entries: add time by hand from the History panel, with a reason picked from your presets or typed freely.
- Timesheet export: export a month to CSV from the History panel, one row per session or per day, with your own columns, separator and date format.
- Data stored locally only.

## How tracking and pausing work

Counting starts on a real action (typing, selecting, scrolling,
navigating, a file write by you or by a tool, or a running process) and
keeps going while the window is focused, so thinking and reading still
count.

Two things do not count as being back at work. A single scroll on its
own, because resizing the window or plugging in a monitor makes the
editor report a scroll nobody performed: a scroll starts a session once
the gesture continues, and once a session runs every scroll counts. And
a focus that does not last five seconds, because crossing your windows
to reach another one focuses each of them on the way: a forgotten
session keeps counting down instead of getting its safety cap back. A
scroll in those first five seconds is ignored too.

What stops tracking depends on the situation, and the extension makes a
deliberate distinction between time it **counts** (you were probably
working) and time it **trims off** (a forgetfulness safety net). Two
rules summarise it: while **focused** the session never pauses on
inactivity (only the focus safety cap eventually stops it), and while
**unfocused** the inactivity grace runs from the moment focus was lost.
Normal delays (inactivity, background) are counted. Safety caps (focus,
debug) trim the idle tail, so a window left open overnight never inflates
your total. Every delay is a setting, listed at the end of this section.
What you do with the counted time is up to you, the extension only
measures it.

**Manual pause.** Click the status bar item while it is counting to
pause: the session is closed and saved, and the indicator turns to
"paused". Click it again in any other state (paused, awaiting, or no
tracking) to start tracking immediately. Tracking also resumes on its
own at the next real action. The `Ignore Current Session` command throws
the open session away instead of saving it.

**Per-project settings.** Every setting can be overridden for a single project. Open the settings (`Ctrl+,`), switch to the **Workspace** tab, and edit the value there, or write it straight into the project's `.vscode/settings.json`. In a multi-root workspace, each folder can also carry its own values in its `.vscode/settings.json`, which apply while you work in a file of that folder. This matters most for `projectName` (the name written to exports) and `exportColumns` (when a client expects a given layout).

**Settings.** All of them live under the `timeTracking.` prefix. A value of the wrong type written by hand in `settings.json` is replaced by the default, and a number outside the range the settings editor accepts is brought back to its nearest limit.

| Setting | Default | What it does |
|---|---|---|
| `inactivityThresholdMinutes` | 30 min | Minutes of silence once the window is **unfocused** before the session shows as paused (you stepped into a browser, a database, docs). That grace **is counted** as work if you come back before the focus cap |
| `backgroundProcessTimeoutMinutes` | 30 min | Minutes a terminal or task process may run with no interaction before tracking pauses. **Counted** as work |
| `focusedIdleCapMinutes` | 60 min | Safety cap for a session with no action at all (a forgotten window). The idle tail is **not counted**: the session ends at your last real action. It also bounds the unfocused grace. `0` disables it |
| `debugIdleCapHours` | 0 (off) | Hours after which a running debug session stops holding tracking open. The tail is **not counted**. `0` lets a debug session hold it indefinitely |
| `minSessionMinutes` | 1 min | A session ending with less than this to record is a false start: **discarded**, however it ended (hand pause, project switch, host suspend, window closed, timeout, safety cap, crash recovery). `0` keeps every session |
| `fontSize` | 14 px | Base font size of the History panel, which the rest of its text scales from. `0` follows the editor font size |
| `gitUserEmail` | (from git) | Which git `user.email` counts as your commits in the history. Empty reads it from the repository, then from the global git config |
| `debugLogging` | off | Writes every signal, decision and recorded interval to the "Time Tracking" output channel and to a log file in the extension storage. For diagnosing behaviour |
| `manualReasons` | Development, Meeting, Code review, Planning, Documentation | Preset reasons offered when you add time by hand from the History panel. Free text is always available on top of the list |
| `projectName` | (folder name) | Name used for the `{project}` token when exporting a timesheet |
| `defaultReason` | Development | Reason given to plain tracked time, which has none of its own. Fills the `{reason}` token on export |
| `exportColumns` | Date, Project, Task, Description, Quantity | Columns of the exported timesheet, each as `Name={template}`. Tokens: `{project}`, `{date}`, `{date_start}`, `{date_end}`, `{start}`, `{end}`, `{total}`, `{hours}`, `{minutes}`, `{reason}`. An empty template gives a blank cell |
| `exportSeparator` | `,` | Character joining the export columns and the header row |
| `exportDateFormat` | `iso8601` | Format of the `{date}` token: a bare date, or a zoned preset (RFC 3339, RFC 1123, RFC 1123 numeric, RFC 850) carrying the row's start time |

## Compatibility

Works on VSCode and VSCodium 1.82 or later. No proprietary dependency, no network calls.

From 1.93, a command running in the integrated terminal counts as a running process, through [terminal shell integration](https://code.visualstudio.com/docs/terminal/shell-integration) (on by default for bash, fish, pwsh, zsh and Git Bash). From 1.82 to 1.92, such a command is not seen: it neither starts a session nor keeps an unfocused session going under the background timeout. Everything else works the same, including tasks, debug sessions and the files a terminal command writes in the workspace.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for the dev environment and the conventions. AI assistants must read [AGENTS.md](AGENTS.md) first.

## License

Public domain via the [Unlicense](LICENSE). The choice is ethical, not
a convenience: part of this code was produced with AI tools whose
training corpora harvested uncompensated human work. Dedicating the
output to the public domain returns it to the commons those corpora drew
from. Contributors are asked to make the same dedication, see
[PATENTS](PATENTS).
