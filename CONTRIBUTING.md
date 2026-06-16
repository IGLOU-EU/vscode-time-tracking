# Contributing to Time Tracking

Thanks for the interest in the project. This is a VSCode/VSCodium
extension that tracks working time automatically, per window and per
project, so you never have to remember to start a timer. The goal is to
keep it small, strictly typed, well tested, and fully compatible with
VSCodium (no proprietary dependency, no CDN).

> **🤖 Using an AI or an agentic tool?** Read [`AGENTS.md`](AGENTS.md)
> first. It contains the mandatory behaviour rules (full human review,
> no auto-commits, commit co-signing, English-only, architecture
> boundaries).

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

## Dev environment

```bash
git clone https://gitlab.com/iglou.eu/vscode-time-tracking
cd vscode-time-tracking
npm install
npm run check-types       # tsc --noEmit
npm run lint              # eslint
npm run test:unit         # Vitest on the pure core
npm run test:unit:watch   # TDD loop (red-green-refactor)
npm run compile           # type-check + esbuild bundle to dist/
npm run test:integration  # smoke tests inside a real Extension Host
```

Node ≥ 18.18 required. Press `F5` in VSCode/VSCodium to launch the
Extension Development Host and try the extension live.

## External documentation

Anything touching the VSCode API must be backed by the authoritative
docs, not training-data guesses. The API ships monthly and `since`
versions matter for VSCodium compatibility.

- [Extension manifest](https://code.visualstudio.com/api/references/extension-manifest)
  and [contribution points](https://code.visualstudio.com/api/references/contribution-points)
- [vscode API reference](https://code.visualstudio.com/api/references/vscode-api)
- [Webview guide](https://code.visualstudio.com/api/extension-guides/webview)
- [Status bar UX](https://code.visualstudio.com/api/ux-guidelines/status-bar)
- [Terminal shell integration](https://code.visualstudio.com/docs/terminal/shell-integration)
- [Localisation (l10n)](https://github.com/microsoft/vscode-l10n)
- [Git extension API](https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts)
- [Testing extensions](https://code.visualstudio.com/api/working-with-extensions/testing-extension)

## Code conventions

### Language

All code and documentation must be in English. Only the localisation
files keep their target language as their value:
`package.nls.fr.json` and `l10n/bundle.l10n.fr.json`. Add a new string
to the English source first (`package.nls.json` or a `vscode.l10n.t`
literal), then propagate the translation.

### Style

- Files in `kebab-case.ts`. Named exports only, no `default export`, so
  `grep` stays useful.
- Types in `PascalCase`, functions/variables in `camelCase`, constants
  in `UPPER_SNAKE_CASE`.
- Early return over nested conditionals.
- One responsibility per file. If a module grows past ~250 lines,
  consider a split.
- Comments describe the **why**, not the **what**. File-header comments
  summarise the module's responsibility in one to three lines.

### Tests

- Every new pure function ships with a matching Vitest suite next to it
  (`src/core/<module>.test.ts`).
- Integration smoke tests (activation, commands, status bar, webview)
  go under `src/test/` and run through `@vscode/test-cli` against a real
  Extension Host.
- Test names in English, one scenario per test.
- The pure core must be deterministic: inject the clock (`now`) and the
  timezone (`midnightOf`), never read them directly in `src/core/`.

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
6. Update the README and related docs in the same commit.
7. Open a merge request with a description focused on **why**.

## License

The project is released into the public domain via the
[Unlicense](LICENSE). The ethical position behind that choice is
spelled out in the file's preamble. By submitting a contribution you
accept the contributor terms in [PATENTS](PATENTS): your contribution is
dedicated to the public domain on the same terms, copyright and patent
claims included. The act of committing to this repository is the act of
acceptance of those terms.
