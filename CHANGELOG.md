# @cvr/okra

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
