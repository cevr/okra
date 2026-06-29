# okra

AI agent orchestration toolkit. Effect v4 + Bun, single-binary build.

## Commands

```bash
bun run gate          # typecheck + lint + fmt + test + build (parallel)
bun run dev           # run from source
bun run build         # compile binary to bin/okra
```

## Architecture

Eight orthogonal domains under `src/`, each with own errors, services, commands:

| Domain      | Subcommand      | Error tag                               | Data dir                                                           |
| ----------- | --------------- | --------------------------------------- | ------------------------------------------------------------------ |
| `schedule/` | `okra schedule` | `ScheduleError`                         | `~/.okra/schedule/`                                                |
| `counsel/`  | `okra counsel`  | `CounselError`                          | `/tmp/counsel/`                                                    |
| `research/` | `okra research` | `ResearchError`                         | `.xp/` (project-local)                                             |
| `brain/`    | `okra brain`    | `BrainError`/`VaultError`/`ConfigError` | `~/.brain/`                                                        |
| `repo/`     | `okra repo`     | `RepoError`                             | `~/.cache/repo/`                                                   |
| `skills/`   | `okra skills`   | `SkillsError`                           | `$SKILLS_DIR` or `~/Developer/personal/dotfiles/skills`            |
| `image/`    | `okra image`    | `ImageError`                            | reads `~/.codex/auth.json` + `~/.okra/keys.json`; writes `-o` path |
| `keys/`     | `okra keys`     | `KeysError`                             | `~/.okra/keys.json` (via shared `KeyStoreService`)                 |

Shared utilities in `src/shared/`: `Provider` schema, `resolveExecutable`, `isColorEnabled`, `KeyStoreService` (`keystore.ts` — generic multi-provider secret store at `~/.okra/keys.json`).

- `main.ts` wires root CLI with `PlatformLayer` (BunServices + FetchHttpClient), error handler matches all domain error tags
- Each domain exports its command via `Command.provide(DomainServiceLayer)` from `index.ts`
- All domains self-provide their service layers at command level — no domain layers in main.ts
- Brain has 3 internal error classes, exposed via single `isBrainDomainError` guard
- Repo and Skills use structural `isRepoError`/`isSkillsError` guards (same pattern as brain)
- Effect v4 (beta.60): `Context.Service`, `Effect.fn`, `Schema.TaggedErrorClass`, `effect/unstable/cli`

## Gotchas

- `Schedule`, `StopEvaluator`, `Verification` are pure modules, not services
- Counsel's `program.ts` has standalone argv handling — used for direct invocation, not the subcommand path
- Research `_loop` command guarded by `OKRA_INTERNAL=1` env var
- Daemon spawns `[process.execPath, "research", "_loop", "--project-root", ...]`
- Plist labels: `com.cvr.okra.schedule-{id}`, program args include `schedule run <id>`
- Brain plist labels: `com.cvr.okra.brain-daemon*`, program args include `brain daemon run <job>`
- Brain daemon modules (schedule, state, reflect, ruminate, meditate, launchd) are pure `Effect.fn` functions, not services
- Brain's `BuildInfo` uses `__ASSET_ROOT__` (compile-time) to locate `starter/` — install-path dependency, not standalone
- `resolveExecutable` falls back to `~/.bun/bin`, `/usr/local/bin`, `~/.local/bin` when `Bun.which` fails (daemon PATH issue)
- oxlint forbids `!` non-null assertions — use `as T` with existence guards
- `@effect-diagnostics effect/nodeBuiltinImport:off` on files using raw `node:fs`/`node:path` (research domain, brain daemon/state, shared/executable)
- Skills' `GitHub.ts` uses `Bun.spawn`/`Bun.which` directly, not via Effect's `ChildProcessSpawner`
- Skills' `SkillStore` reads `$SKILLS_DIR` env var at layer construction time via `Config.option`
- Skills has `lib/` subdirectory for non-service code (frontmatter, source parsing, search API, fs helpers)
- Repo's `CacheService` creates `~/.cache/repo/` directory at layer construction time
- Repo test-utils are at `src/repo/test-utils/` with mock layers for all 4 services
- Image has two backends selected by `--model` via `isOpenAiImageModel` (prefixes `gpt-image`/`dall-e`): codex (default `gpt-5.5`) vs the metered OpenAI Images API
- Codex path uses `@effect/ai-openai` (`OpenAiClient` + `OpenAiLanguageModel` + `OpenAiTool.ImageGeneration`) pointed at `https://chatgpt.com/backend-api/codex`; auth = OAuth token from `~/.codex/auth.json` (`codex login`)
- OpenAI path (`OpenAiImagesService`) POSTs `/images/generations` with the generated `Generated.CreateImageRequest` schema and decodes `Generated.ImagesResponse` (the high-level `OpenAiClient` does NOT surface `createImage`); models `gpt-image-1.5` (default for that path) / `gpt-image-1` / `gpt-image-1-mini` / `dall-e-*`
- `KeyStoreService` (`src/shared/keystore.ts`) is a generic, cross-domain secret store: a flat `{ provider: key }` map at `~/.okra/keys.json` (0600). Methods: `resolve(name, envVar)` (precedence **env > stored**), `store(name, key)` (merges — preserves other providers), `list` (sorted names, never values), `remove(name)` (→ bool), `describe(name, envVar)` (→ `KeyStatus { source: "env"|"stored"|"missing"; masked: Option<string> }` — never the raw secret). `maskSecret` (prefix…last4, short→bullets) and `PROVIDER_ENV_VARS`/`envVarForProvider` (provider→env-var map) are exported too. It fails `KeyStoreError`; consuming domains map it to their own error. Not OpenAI-specific. Requires `FileSystem | Path` (bubbles to the root PlatformLayer)
- The `keys` domain (`okra keys set/list/get/rm <provider>`) is the user-facing front end for `KeyStoreService`; it maps `KeyStoreError` → `KeysError`. `set` takes a `--stdin` flag (key avoids shell history); `get` prints a masked preview + source to stdout (exit 1 / `NOT_FOUND` when unset). The OpenAI key is stored under provider name `"openai"` (`OPENAI_KEY_NAME` in `image/constants.ts`; mirrored in shared `PROVIDER_ENV_VARS`). There is NO `okra image set-key` — key management is centralized in `keys`
- Image's `--quality`/`--background`/`--n` are optional flags that only feed the OpenAI Images request (`CreateImageRequest`); the codex path ignores them and prints a note when they're set. `OpenAiImagesService.generate` returns `ReadonlyArray<Uint8Array>` (one per `--n`); the command writes `out-1.<ext>`, `out-2.<ext>`, … when >1 (single image keeps the bare path). Codex always yields exactly one image
- Image's `CodexModel` builds the client via `OpenAiClient.make({ transformClient })`: `transformClient` must transform the passed-in client (which already prepends `apiUrl`), not replace it; it injects per-request `Authorization`/`chatgpt-account-id`/`originator`/`version`/`session_id`/`User-Agent` headers and applies the SSE patch
- Codex backend requires `store: false` + `stream: true` and a current `version` header; it streams SSE with **no** `content-type` header
- `ImageGenService` is transport-agnostic (consumes a provided `LanguageModel`) so the model layer is provided per-invocation in the command handler (parameterized by `--model`) — hence `strictEffectProvide:off` on `image/commands/index.ts`
- `CodexStreamPatch` rewrites the codex-only `image_generation_call` status `"generating"` → `"in_progress"` at SSE-event granularity before decoding, working around upstream `OpenAiSchema.MessageStatus` which omits `"generating"` (their `Generated.ts` includes it; the handwritten streaming schema is stricter)
- Image command pre-checks `CodexAuthService.load` before generating, so missing creds surface as `AUTH_MISSING` (not a boxed transport error); `isUnauthorized` matches the structured `AiError.reason._tag === "AuthenticationError"`, not message substrings

## Skills

| Subcommand      | Skill                      |
| --------------- | -------------------------- |
| `okra schedule` | `skills/schedule/SKILL.md` |
| `okra counsel`  | `skills/counsel/SKILL.md`  |
| `okra research` | `skills/research/SKILL.md` |
| `okra brain`    | `skills/brain/SKILL.md`    |
| `okra repo`     | `skills/repo/SKILL.md`     |
| `okra skills`   | `skills/skills/SKILL.md`   |
| `okra image`    | `skills/image/SKILL.md`    |
| `okra keys`     | `skills/keys/SKILL.md`     |
