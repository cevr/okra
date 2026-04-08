# okra

AI agent orchestration toolkit. Effect v4 + Bun, single-binary build.

## Commands

```bash
bun run gate          # typecheck + lint + fmt + test + build (parallel)
bun run dev           # run from source
bun run build         # compile binary to bin/okra
```

## Architecture

Six orthogonal domains under `src/`, each with own errors, services, commands:

| Domain | Subcommand | Error tag | Data dir |
| ------ | ---------- | --------- | -------- |
| `schedule/` | `okra schedule` | `ScheduleError` | `~/.okra/schedule/` |
| `counsel/` | `okra counsel` | `CounselError` | `/tmp/counsel/` |
| `research/` | `okra research` | `ResearchError` | `.xp/` (project-local) |
| `brain/` | `okra brain` | `BrainError`/`VaultError`/`ConfigError` | `~/.brain/` |
| `repo/` | `okra repo` | `RepoError` | `~/.cache/repo/` |
| `skills/` | `okra skills` | `SkillsError` | `$SKILLS_DIR` or `~/Developer/personal/dotfiles/skills` |

Shared utilities in `src/shared/`: `Provider` schema, `resolveExecutable`, `isColorEnabled`.

- `main.ts` wires root CLI with `PlatformLayer` (BunServices + FetchHttpClient), error handler matches all domain error tags
- Each domain exports its command via `Command.provide(DomainServiceLayer)` from `index.ts`
- All domains self-provide their service layers at command level — no domain layers in main.ts
- Brain has 3 internal error classes, exposed via single `isBrainDomainError` guard
- Repo and Skills use structural `isRepoError`/`isSkillsError` guards (same pattern as brain)
- Effect v4: `ServiceMap.Service`, `Effect.fn`, `Schema.TaggedErrorClass`, `effect/unstable/cli`

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

## Skills

| Subcommand | Skill |
| ---------- | ----- |
| `okra schedule` | `skills/schedule/SKILL.md` |
| `okra counsel` | `skills/counsel/SKILL.md` |
| `okra research` | `skills/research/SKILL.md` |
| `okra brain` | `skills/brain/SKILL.md` |
| `okra repo` | `skills/repo/SKILL.md` |
