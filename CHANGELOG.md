# @cvr/okra

## 0.6.1

### Patch Changes

- [`f7235c3`](https://github.com/cevr/okra/commit/f7235c363a8dba33798fca9186fcb0abda1e30fe) Thanks [@cevr](https://github.com/cevr)! - Deduplicate provider-specific copies of the same skill during GitHub repository discovery.

  `okra skills add owner/repo` now presents each installable skill once and prefers the portable root layout, then `.agents/skills`, when repositories publish mirrored variants for multiple agent harnesses.

## 0.6.0

### Minor Changes

- [`3d09082`](https://github.com/cevr/okra/commit/3d09082fd25935bdcdd3eb90a97e7dd793e33664) Thanks [@cevr](https://github.com/cevr)! - Update `okra counsel` to select explicit models for standard and deep runs.

  - Claude standard runs use Opus 4.8 at medium effort; `--deep` uses Fable at max effort.
  - Codex runs use GPT-5.6 SOL at medium effort; `--deep` raises reasoning effort to xhigh.

- [`ac17603`](https://github.com/cevr/okra/commit/ac17603ad21ef11e5e83c93999c1880daba180f4) Thanks [@cevr](https://github.com/cevr)! - Add the `okra image` command with two backends and a shared, multi-provider key store.

  - **Dual backend, chosen by `--model`.** GPT-image / DALL·E models (`gpt-image-1.5`, `gpt-image-1`, `gpt-image-1-mini`, `dall-e-*`) route to the metered OpenAI Images API (`POST /images/generations`); every other model (default `gpt-5.5`) streams through the ChatGPT codex backend, reusing the `codex login` OAuth token. No separate `--backend` flag — the model id decides.
  - **OpenAI image controls.** New optional flags surfaced for the OpenAI path: `--quality` (auto/low/medium/high), `--background` (auto/transparent/opaque), and `--n` (image count). They're ignored by the codex backend, which prints a note when they're passed.
  - **Shared key store (`~/.okra/keys.json`).** A new generic, cross-domain `KeyStoreService` (in `src/shared/`) persists API keys by provider name as a flat JSON map (`{ "openai": "sk-..." }`), created `0600`. Resolution precedence is **env var > stored key**. Store the OpenAI key with `okra image set-key <key>` or `okra image set-key --stdin` (the latter keeps the key out of shell history). `set-key` merges into the existing map, so future providers can share the same file.

- [`b411f0c`](https://github.com/cevr/okra/commit/b411f0cae357e9ac98a74003bc4141b6a45286a6) Thanks [@cevr](https://github.com/cevr)! - `okra image` gains `--fidelity` for high-fidelity edits.

  When editing with a GPT image model, `--fidelity high` makes the model preserve the source image's detail and features — notably faces — instead of the default `low`. It maps to the OpenAI `/images/edits` `input_fidelity` field.

  `--fidelity` is edits-only and model-gated:

  - Requires the edit route (a `--ref` source); `--fidelity` on a plain generation → `INVALID_INPUT` ("only applies when editing").
  - Supported on `gpt-image-1` / `gpt-image-1.5` only — `gpt-image-1-mini` → `INVALID_INPUT`.
  - On the codex backend → `INVALID_INPUT` (use an OpenAI image model).

  Omitting `--fidelity` leaves the API default (`low`) in place.

- [`cbb84c2`](https://github.com/cevr/okra/commit/cbb84c2bb35c4054751c50ab5938373733f81a7e) Thanks [@cevr](https://github.com/cevr)! - `okra image` gains `--edit` and `--mask` for pixel-level image editing (OpenAI GPT image models).

  On a GPT image model (`gpt-image-1.5`, `gpt-image-1`, `gpt-image-1-mini`), `--ref <path>` is the **source image to edit** and routes to the OpenAI `/images/edits` endpoint, returning an edited version of the source. `--edit` is an explicit opt-in to the same behavior; `--mask <path>` supplies a PNG whose transparent areas mark where the edit applies. Multiple `--ref` are sent as up to 16 source images.

  Routing is reconciled from the model + flags:

  - **codex** (default) + `--ref` → style reference (unchanged); codex + `--edit`/`--mask` → `INVALID_INPUT` (codex has no pixel-edit primitive — use `--model gpt-image-1.5`).
  - **OpenAI** + any input image → `/images/edits`. `--edit`/`--mask` without `--ref` → `INVALID_INPUT` (needs a source). `dall-e-*` + `--ref` → `INVALID_INPUT` (not edit-capable).

  Editing requires an OpenAI API key (`OPENAI_API_KEY` or `okra keys set openai`), like the other OpenAI image paths.

- [`c735a49`](https://github.com/cevr/okra/commit/c735a49782ba4a8a833d0ef5143ac62910897e8a) Thanks [@cevr](https://github.com/cevr)! - `okra image` gains `--ref <path>` for style/composition references.

  Pass `--ref` (repeatable) to condition generation on one or more reference images — the model produces a **new** image guided by the reference's style, palette, and composition, without editing the reference itself. References are attached as input images to the codex backend via the Responses API's `input_image` content. Supported types: png, jpg, jpeg, webp, gif.

  On the **codex** backend `--ref` is a style reference (a new image is generated). On an **OpenAI image model** (`gpt-image-*`) `--ref` is the source image to edit and routes to `/images/edits` (see the `--edit`/`--mask` changeset).

- [`153b928`](https://github.com/cevr/okra/commit/153b928567ae707ae51e5be1e52f08ad53f97485) Thanks [@cevr](https://github.com/cevr)! - Add the `okra keys` command and multi-image output for `okra image`.

  - **`okra keys` — centralized API-key management.** A new top-level command over the shared `KeyStoreService`: `okra keys set <provider> [<key>] [--stdin]`, `okra keys list` (prints provider **names** only, never values), `okra keys get <provider>` (a masked presence check — shows `sk-pr…1234 (stored)` or `(env OPENAI_API_KEY)`, exits 1 with `NOT_FOUND` when unset), and `okra keys rm <provider>`. `set` merges into `~/.okra/keys.json` (0600), so providers don't clobber each other. The key store gained `list`, `remove`, and `describe` methods alongside `resolve`/`store`.
  - **Removed `okra image set-key`.** Key management is now centralized in `okra keys` — store the OpenAI key with `okra keys set openai <key>` (or `--stdin`). Resolution precedence is unchanged: env `OPENAI_API_KEY` > stored key.
  - **`--n` writes every image.** The OpenAI Images path now returns all generated images instead of just the first. With `--n > 1`, files are suffixed before the extension (`out.png` → `out-1.png`, `out-2.png`, …); a single image keeps the bare path. stdout lists every saved path, one per line. The codex backend always produces exactly one image.

### Patch Changes

- [`f290e34`](https://github.com/cevr/okra/commit/f290e34faef81bf05a8279e69c271e1bf9ff4a26) Thanks [@cevr](https://github.com/cevr)! - `okra image` (OpenAI backends) now surfaces the API's real error message.

  A non-2xx response from `/images/generations` or `/images/edits` previously collapsed to an opaque `non 2xx status code (400 ...)`. The OpenAI error body (`{ "error": { "message": "..." } }`) is now read and included, so failures like `Billing hard limit has been reached.` or a rejected prompt reach the user directly (with the HTTP status). 401/403 still map to `AUTH_EXPIRED` but now carry the API's reason too.

## 0.5.0

### Minor Changes

- [`de2a07c`](https://github.com/cevr/okra/commit/de2a07c17c1a6ffccf954a4bd1e1040aa5ee7f9f) Thanks [@cevr](https://github.com/cevr)! - Align with `project-scaffolding` skill spec: full Effect v4 idioms with strict tsgo diagnostics.

  - Route all `process.env` access through `Config.option(Config.string(...)).asEffect()` so env reads honor the ambient `ConfigProvider` (enables `ConfigProvider.layer(...)` / `Effect.provideService` injection in tests instead of mutating `process.env`).
  - Replace `new Date()` with `Clock.currentTimeMillis` / `DateTime.now` across `src/`; threading explicit `nowMs` into pure modules (`Schedule.parse`, `StopEvaluator.evaluate`, `formatRelativeTime`, `generateSlug`).
  - Convert remaining `async function` blocks to `Effect.fn` with `Effect.tryPromise({ try: () => proc.exited })` shape.
  - Migrate tests to `effect-bun-test` patterns: `it.scoped` + `FileSystem.makeTempDirectoryScoped`, `it.scopedLive` where production code uses the real Clock, `ConfigProvider.fromEnv({ env })` for env injection.
  - Refactor 4 high-complexity functions inline (`Schedule.parseSync`, `ExperimentLog.reconstructFromEvents`, `Loop.run`, `init` handler, `brain extract.extractConversations`) without raising the `complexity: 20` lint ceiling.
  - `lefthook.yml`: collapse pre-commit to a single `parallel: true` stage (`lint+fmt && typecheck && build && test` chained).
  - `.oxlintrc.json`: disable `no-underscore-dangle`, `consistent-return`, and three noisy `typescript/no-unnecessary-*` rules.
  - `tsconfig.json`: enable all Effect diagnostics at error severity except `effectMapFlatten`, `missedPipeableOpportunity`, `strictBooleanExpressions`, `unnecessaryPipe`, `unnecessaryPipeChain`; tests override only `strictEffectProvide`; scripts override every rule off.

- [`f3e8ddb`](https://github.com/cevr/okra/commit/f3e8ddb5e698e1a859afc59cb29b859ea82ab6b9) Thanks [@cevr](https://github.com/cevr)! - **skills:** auto-recover `skillPath` when an upstream skill moves within its source repo.

  When `okra skills update` 404s fetching a skill's directory (e.g. `mattpocock/skills` moved `handoff` from `skills/in-progress/` to `skills/productivity/`), the updater now falls back to `discoverSkills` on the repo, matches by leaf dirname, refetches from the new location, and rewrites the lock entry's `skillPath` in the batched lock write. Surfaces as a new `moved` status in the per-skill progress UI.

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
