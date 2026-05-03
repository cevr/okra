# @cvr/okra

## 0.4.0

### Minor Changes

- [`e0e52e4`](https://github.com/cevr/okra/commit/e0e52e45449a621c4e2a779897ea1063a89f9673) Thanks [@cevr](https://github.com/cevr)! - Skills add: live per-skill progress UI

  `okra skills add` now renders the same live spinner-per-skill progress UI as `okra skills update`. After discovery and any selection prompts complete, all installations run in parallel under a progress display showing pending → installing → installed/failed. In non-TTY environments, terminal statuses print inline as they complete.

  The progress controller (`src/skills/lib/progress.ts`) was made fully testable by injecting `tty` and `write` overrides via `MakeOptions`, with tests covering both TTY and non-TTY rendering paths, ANSI escape sequences, and ticker fiber lifecycle.

- [`881d551`](https://github.com/cevr/okra/commit/881d5514c3bc029836dd1a302d75a3acf91378f6) Thanks [@cevr](https://github.com/cevr)! - Skills update: live per-skill progress UI

  `okra skills update` now renders a live progress line per skill with a spinner while updating, and updates each line in place as results come in instead of printing a batched summary at the end. Each skill shows pending → updating → updated/unchanged/removed/failed with a status glyph and color.

  In non-TTY environments (CI, piped output), it falls back to printing each terminal status inline as it completes — preserving scriptable output.

- [`a1421e7`](https://github.com/cevr/okra/commit/a1421e73d2e3175223da9d291d028b8f44c3da06) Thanks [@cevr](https://github.com/cevr)! - Skills CLI: variadic args, aliases, multi-select prompt

  - `okra skills add` and `okra skills remove` now accept multiple sources/names in one invocation (e.g. `okra skills add owner/a owner/b ./local`).
  - Aliases: `add` ↔ `i` ↔ `install`, `remove` ↔ `rm` ↔ `uninstall`.
  - When a repo or local folder contains multiple skills, an interactive multi-select prompt lets you choose which to install (single-skill paths still install directly).
  - Dropped the redundant `--skill/-s` flag (the existing `owner/repo@skill` syntax already covers it).

  Internal: bumped `effect` and `@effect/platform-bun` from `4.0.0-beta.31` to `4.0.0-beta.60`. Includes the `ServiceMap` → `Context` rename across all service definitions and a few smaller v4 beta API fixes (`FileSystem.File.Info.mtime` is now `Option<Date>`).

### Patch Changes

- [`7283211`](https://github.com/cevr/okra/commit/72832117e4545677ef8e75a4a09b0150334b5df2) Thanks [@cevr](https://github.com/cevr)! - Dev tooling: switch from `tsc` + `@effect/language-service` to `tsgo` (`@typescript/native-preview`) + `@effect/tsgo`.

  `tsgo` runs the Effect Language Service plugin natively at the CLI, which surfaced pre-existing diagnostic warnings the old toolchain silently dropped. As part of the swap:

  - Replaced raw `node:fs` / `node:path` usage with Effect platform services (`FileSystem`, `Path`) across research services/commands, brain daemon state, and `shared/executable` — removing the need for `@effect-diagnostics nodeBuiltinImport:off` pragmas in production code.
  - Replaced `JSON.parse` / `JSON.stringify` with `Schema.fromJsonString` across CLI `--json` output, state files, and tests.
  - Converted `SkillLock.addMany` / `updateMany` to `Effect.fn` form.
  - Replaced `instanceof ResearchError` with a `_tag` discriminator check.
  - Refactored `SkillStore.readDir` so `FileSystem | Path` requirements bubble through the type system rather than being provided mid-pipeline.
  - Globally disabled `strictBooleanExpressions` (style preference, not correctness).

  Runtime behavior is unchanged. This is a build/dev-tooling commit.

## 0.3.0

### Minor Changes

- [`182920b`](https://github.com/cevr/okra/commit/182920b8deb25e2b1c6f8f080904de21307cfebe) Thanks [@cevr](https://github.com/cevr)! - Add skills and repo as okra subcommands

  - `okra skills` — manage AI agent skills from GitHub repos (add, search, remove, update)
  - `okra repo` — multi-registry source code cache manager (fetch, list, remove, clean, path)
  - All domains now use command-level layer provision via `Command.provide`
  - FetchHttpClient added to global platform layer
  - Unified error handling with centralized `tapCause` in main.ts

## 0.2.0

### Minor Changes

- [`84d6c39`](https://github.com/cevr/okra/commit/84d6c39b95883767bf7c8f37fd8e201351fee796) Thanks [@cevr](https://github.com/cevr)! - Switch agent invocations to streaming JSON output for crash resilience

  - Counsel: claude uses `--output-format stream-json`, codex uses `--json`
  - Research: codex uses `--json`, extracts agent message from JSONL events
  - Both providers now write `events.jsonl` with incremental events, postprocessed to `.md`
  - Simplified InvocationRunner: spawn directly to `Bun.file()`, deleted fragile JS stream bridge
  - Added `extractCodexMessage` and `extractClaudeMessage` using Schema-decoded JSONL parsing via `Bun.JSONL.parse`
  - Added `eventsFile` to counsel `RunManifest` for raw event access
  - Added `--color never` to all codex invocations for clean machine-consumed output
