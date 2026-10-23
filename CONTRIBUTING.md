# Contributing to Time Tracking

Thanks for the interest in the project. This is a VSCode/VSCodium
extension that tracks working time automatically, per window and per
project, so you never have to remember to start a timer. The goal is to
keep it small, strictly typed, well tested, and fully compatible with
VSCodium (no proprietary dependency, no CDN).

> **🤖 Using an AI or an agentic tool?** Read [`AGENTS.md`](AGENTS.md) first. It adds the rules specific to AI assistants (full human review, no auto-commits, the LLM assistance declaration, architecture boundaries). Everything in this file applies to them too.

## Philosophy

- **KISS**: prefer the obvious to the clever. Three repeated lines beat
  a premature abstraction.
- **Automatic and unobtrusive.** The product exists because manual
  trackers get forgotten. Favour passive, automatic behaviour over
  anything that asks the user to act, and keep the UI sober (minute
  granularity, no second-by-second counter).
- **Pure core, thin adapters.** Anything testable without a running
  VSCode (interval math, aggregation, the active/paused reducer, JSONL
  parsing, SVG rendering, commit counting) lives under
  [`src/core/`](src/core/) with **no `vscode` import** and is unit
  tested under Node with Vitest. The [`src/adapters/`](src/adapters/)
  layer only bridges the VSCode API to the core and never computes a
  duration.
- **No runtime dependencies.** The extension relies on the `vscode` API
  and the Node standard library only. Everything else is a devDependency.
- **Strict TypeScript.** `strict`, `noUnusedLocals`,
  `noUnusedParameters`, `noImplicitReturns`,
  `noFallthroughCasesInSwitch`. No `any`. Prefer `unknown` + a type
  guard, or a discriminated union.

## One source of truth

Every fact lives in exactly one place: a value, a computation, a rule, a documented behaviour. Everything else derives from it or links to it. A copy always ends up drifting from its original, so a duplicate is a defect to fix, in code as in docs.

In code:

- Setting defaults live in the `contributes.configuration` block of `package.json`. Code that reads a setting never repeats its default.
- Durations are computed in `src/core/` only. Adapters and the webview display what the core returns and never recompute it.
- The stored data is the raw JSONL intervals. Everything shown or exported (day totals, the multi-window union, sessions, charts) is derived from it at read time, and the History panel and the export consume the same derived sessions, so they match by construction.
- The user's settings belong to the user. The extension reads them and never writes them back: a limit applies when the value is read.
- A helper exists once. Share it from `src/core/` instead of copying it.
- The version lives in `package.json`, bumped with `npm version`, which updates the lock file too. No other file hardcodes it.
- The English strings are the source of every translation (see [Language](#language)).

In docs:

- A rule lives in one file and the others link to it. Conventions for everyone live here, rules specific to AI assistants in [`AGENTS.md`](AGENTS.md), behaviour as users see it in the [README](README.md), user-facing changes in the [changelog](CHANGELOG.md).
- Link to the source of a technical fact (a version, a command, a default) instead of restating it.
- A change that alters a documented behaviour updates the doc that owns it in the same commit.

## Dev environment

```bash
git clone https://gitlab.com/iglou.eu/vscode-time-tracking
cd vscode-time-tracking
npm install
npm run check-types       # tsc --noEmit, on the extension and on the History page (media/)
npm run lint              # eslint
npm run test:unit         # Vitest on the pure core
npm run test:unit:watch   # TDD loop (red-green-refactor)
npm run compile           # type-check + esbuild bundle to dist/
npm run test:integration  # compile, then smoke tests in a real Extension Host, on a recent and the oldest supported editor
```

Use the Node version required by `engines.node` in [`package.json`](package.json), as npm refuses to install on another one. Press `F5` in VSCode/VSCodium to compile and launch the Extension Development Host on the sample workspace (`.vscode/launch.json`), with a dedicated profile under `.vscode-test/` and the other extensions disabled, and try the extension live.

The integration tests download the editors they run on into `.vscode-test/`: the oldest supported one, and a recent one pinned in [`.vscode-test.mjs`](.vscode-test.mjs), which says when to raise it. To run them on VSCodium as well, set `VSCODIUM_PATH` to the Electron binary of a local install, the `codium` file next to its `resources/` folder (its path depends on the install), not the `bin/codium` launcher script: it goes through the editor command line and returns at once, so the run reports success without any test. On Linux, `xvfb-run -a` keeps the test windows off the screen:

```bash
VSCODIUM_PATH=/opt/vscodium-bin/codium xvfb-run -a npm run test:integration
```

## External documentation

Anything touching the VSCode API must be backed by the authoritative docs, not training-data guesses. The API ships monthly and `since` versions matter for VSCodium compatibility. Cite the source in a comment when the choice is not obvious.

The oldest supported editor is `engines.vscode` in [`package.json`](package.json), and `@types/vscode` is pinned to it with a tilde, so the type check refuses a newer API. Every API, contribution point and webview feature must exist at that version, whose Electron sets the Node of the extension host and the Chromium of the webview (see the release notes of that version). Terminal shell integration (1.93) is the one API above it, feature-detected in `src/adapters/signals.ts`. Anything else newer raises the floor, and the README compatibility section follows it.

| What you're touching | Where to look first |
| --- | --- |
| Extension manifest, contribution points | <https://code.visualstudio.com/api/references/extension-manifest> + <https://code.visualstudio.com/api/references/contribution-points> |
| Any `vscode` namespace API | <https://code.visualstudio.com/api/references/vscode-api> + `vscode.d.ts` |
| Webview / webview view | <https://code.visualstudio.com/api/extension-guides/webview> |
| Status bar | <https://code.visualstudio.com/api/ux-guidelines/status-bar> |
| Terminal shell integration (1.93+) | <https://code.visualstudio.com/docs/terminal/shell-integration> |
| Localisation (l10n) | <https://code.visualstudio.com/api/references/vscode-api#l10n> + <https://github.com/microsoft/vscode-l10n> |
| Git extension API | <https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts> |
| Testing | <https://code.visualstudio.com/api/working-with-extensions/testing-extension> |

## Code conventions

### Language

All code and documentation must be in English. Only the localisation
files keep their target language as their value:
`package.nls.fr.json` and `l10n/bundle.l10n.fr.json`. Add a new string
to the English source first (`package.nls.json` or a `vscode.l10n.t`
literal), then propagate the translation.

The translation key is the whole English sentence, so pass `vscode.l10n.t` one plain string literal with named parameters (`{name}`). `npm run test:unit` checks the translations against the code ([`src/l10n.test.ts`](src/l10n.test.ts)): it fails on a call that passes anything else, a text already translated included, on a literal missing from the French bundle, on a translation the code no longer uses, on a translation whose `{name}` parameters differ from its source, and on a manifest key missing from, or unused in, either `package.nls` file.

The status bar keywords `idle` and `out` are deliberately left untranslated.

### Vocabulary

- Tracked time is **counted** or **not counted**, and a safety cap **deducts** an idle tail. The extension measures time and has no commercial purpose: never describe it in terms of charging anyone. This holds everywhere, from the UI to the docs, the code, the tests and the commit messages.
- The timesheet export stays generic. Never name a target application in code, settings, examples or docs.

### Style

- Files in `kebab-case.ts`. Named exports only, no `default export`, so
  `grep` stays useful.
- Types in `PascalCase`, functions/variables in `camelCase`, constants
  in `UPPER_SNAKE_CASE`.
- Early return over nested conditionals.
- One responsibility per file. If a module grows past ~250 lines,
  consider a split.
- Comments describe the **why**, not the **what**: the reason or the constraint behind a choice, a subtle invariant, a `since` version or a VSCode issue. They never narrate the code, nor the discussion that led to a change. File-header comments summarise the module's responsibility in one to three lines.
- Prose in comments and docs uses no em-dash and no semicolon.

### Design rules

These come from fixed bugs. Keep them so the bugs stay fixed.

- Provisional time (the session still running) never goes into a permanent file such as an export. Only closed time is written.
- Never cache a failure. Only an authoritative result, an authoritative zero included, may be cached.

### Tests

- Every new pure function ships with a matching Vitest suite next to it
  (`src/core/<module>.test.ts`).
- A bug fix ships with a test that fails without it: a core test when the logic is pure, an integration test under `src/test/` otherwise.
- Integration smoke tests (activation, commands, status bar, webview)
  go under `src/test/` and run through `@vscode/test-cli` against a real
  Extension Host.
- Test names in English, one scenario per test.
- The pure core must be deterministic: inject the clock (`now`) and the
  timezone (`midnightOf`), never read them directly in `src/core/`.

### Commit messages

- [Conventional Commits](https://www.conventionalcommits.org/): `type(optional scope): subject`, in lowercase, with no trailing period and 80 characters at most. Usual types: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `style`, `chore`, `ci`, `build`.
- Sign off every commit (`git commit -s`).
- The gitmoji that starts each subject in the history is added by the maintainer's commit hook. Do not type it.
- A commit an LLM took part in carries the trailer set in [AGENTS.md](AGENTS.md#3-declare-llm-assistance).

## Contribution cycle

1. Create a descriptive branch (`feat/status-bar-pause`,
   `fix/midnight-split-dst`).
2. Code following the conventions above, test-first for the core.
3. Run locally: `npm run check-types && npm run lint && npm run test:unit && npm run compile`.
   All must pass.
4. If you touch a VSCode API, cite the doc source in a comment.
5. If you want to change architecture (the three-layer split, the
   storage model, the activity model), **open an issue to discuss
   first**, no surprise merge requests.
6. In the same commit, update the doc that owns any behaviour you changed: the README for what users see, the changelog under `Unreleased`, `AGENTS.md` §5 for the activity model.
7. Open a merge request with a description focused on **why**.

## License

The project is released into the public domain via the
[Unlicense](LICENSE). The ethical position behind that choice is
spelled out in the file's preamble. By submitting a contribution you
accept the contributor terms in [PATENTS](PATENTS): your contribution is
dedicated to the public domain on the same terms, copyright and patent
claims included. The act of committing to this repository is the act of
acceptance of those terms.
