# Time Tracking

A VSCode/VSCodium extension that tracks your working time automatically,
designed so you never have to think about it.

## Why

Starting a time tracker by hand means forgetting it half the time, and
by the time you remember, the count is already wrong. This extension
tracks time passively, per window and per project, with no action on
your part.

## Principles

- **One window = one autonomous tracker.** Two windows open on the same
  project each count on their own. The real worked time is the union of
  both (window 1 from 14:00 to 16:00 plus window 2 from 14:30 to 17:00
  gives 3 hours).
- **One project = one folder.** In multi-folder workspaces, time is
  attributed to the folder of the active file.
- **Automatic, focus-aware tracking.** Counting starts on a real action
  (typing, scrolling, navigating, a file write, a running process) and
  keeps going while the window is focused, so thinking and reading
  count. Leaving the editor does not stop it: a configurable inactivity
  grace covers work in a browser, a database, or documentation. A long
  focus safety cap guards against a forgotten window, and that idle tail
  is deducted rather than billed.
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
