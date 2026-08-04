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
  breakdown.
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
working) and time it **trims off** (a forgetfulness safety net):

| Limit | Setting | Default | When it applies | Effect |
|---|---|---|---|---|
| Inactivity grace | `timeTracking.inactivityThresholdMinutes` | 30 min | Window **unfocused**, no activity (you stepped into a browser, a database, docs) | Pauses after the delay; the grace **is counted** as work |
| Background process timeout | `timeTracking.backgroundProcessTimeoutMinutes` | 30 min | A terminal/task process is running with no interaction | Pauses after the delay; **counted** as work |
| Focus safety cap | `timeTracking.focusedIdleCapMinutes` | 60 min | Window **focused** but no action at all (a forgotten window) | Pauses; the idle tail is **not counted**, the session ends at your last real action |
| Debug safety cap | `timeTracking.debugIdleCapHours` | 0 (never) | A debug session holds tracking open with no interaction | Off by default; when set, pauses and the tail is **not counted** |
| Short-session threshold | `timeTracking.minSessionMinutes` | 1 min | A session ends with less than this much time to record, however it ended (hand pause, project switch, timeout, window closed, crash recovery) | Treated as a false start: **discarded** (not counted). A hand pause returns to awaiting confirmation, not paused. `0` keeps every session |

Two rules summarise it: while **focused** the session never pauses on
inactivity (only the focus safety cap eventually stops it), and while
**unfocused** the inactivity grace runs from the moment focus was lost.
Normal delays (inactivity, background) are counted; safety caps (focus,
debug) trim the idle tail, so a window left open overnight never inflates
your total. What you do with the counted time is up to you, the extension
only measures it.

**Manual pause.** Click the status bar item while it is counting to
pause: the session is closed and saved, and the indicator turns to
"paused". Click it again in any other state (paused, awaiting, or no
tracking) to start tracking immediately. Tracking also resumes on its
own at the next real action. The `Ignore Current Session` command throws
the open session away instead of saving it.

Other settings: `timeTracking.gitUserEmail` (which email counts as your
commits in the history, defaults to the repo `user.email`) and
`timeTracking.debugLogging` (an output channel and log file for
diagnosing behaviour).

**Per-project settings.** Every setting can be overridden for a single
project. Open the settings (`Ctrl+,`), switch to the **Workspace** tab,
and edit the value there, or write it straight into the project's
`.vscode/settings.json`. This matters most for
`timeTracking.projectName` (the name written to exports) and
`timeTracking.exportColumns` (when a client expects a given layout).

## Compatibility

Works on VSCode and VSCodium. No proprietary dependency, no network
calls. Targets `engines.vscode >= 1.93` so terminal shell integration is
available; older clients degrade gracefully.

## Development

See `docs/vscode-extension-dev.md` (local) for the full guide, and
[CONTRIBUTING.md](CONTRIBUTING.md) for conventions. AI assistants must
read [AGENTS.md](AGENTS.md) first.

```bash
npm install
npm run test:unit:watch   # TDD loop on the pure core
npm run check-types       # tsc --noEmit
npm run lint              # eslint
npm run compile           # type-check + bundle
npm run test:integration  # smoke tests in an Extension Host
```

## License

Public domain via the [Unlicense](LICENSE). The choice is ethical, not
a convenience: part of this code was produced with AI tools whose
training corpora harvested uncompensated human work. Dedicating the
output to the public domain returns it to the commons those corpora drew
from. Contributors are asked to make the same dedication, see
[PATENTS](PATENTS).
