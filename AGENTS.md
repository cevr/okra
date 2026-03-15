# okra

AI agent orchestration toolkit. Effect v4 + Bun, single-binary build.

## Commands

```bash
bun run gate          # typecheck + lint + fmt + test + build (parallel)
bun run dev           # run from source
bun run build         # compile binary to bin/okra
```

## Architecture

Three orthogonal domains under `src/`, each with own errors, services, commands:

| Domain | Subcommand | Error tag | Data dir |
| ------ | ---------- | --------- | -------- |
| `schedule/` | `okra schedule` | `ScheduleError` | `~/.okra/schedule/` |
| `counsel/` | `okra counsel` | `CounselError` | `/tmp/counsel/` |
| `research/` | `okra research` | `ResearchError` | `.xp/` (project-local) |

Shared utilities in `src/shared/`: `Provider` schema, `resolveExecutable`, `isColorEnabled`.

- `main.ts` wires root CLI, error handler matches all three error tags
- Each domain exports its command + service layer from `index.ts`
- Schedule and Research layers provided at root; Counsel uses `Command.provide` on its own command
- Effect v4: `ServiceMap.Service`, `Effect.fn`, `Schema.TaggedErrorClass`, `effect/unstable/cli`

## Gotchas

- `Schedule`, `StopEvaluator`, `Verification` are pure modules, not services
- Counsel's `program.ts` has standalone argv handling — used for direct invocation, not the subcommand path
- Research `_loop` command guarded by `OKRA_INTERNAL=1` env var
- Daemon spawns `[process.execPath, "research", "_loop", "--project-root", ...]`
- Plist labels: `com.cvr.okra.schedule-{id}`, program args include `schedule run <id>`
- `resolveExecutable` falls back to `~/.bun/bin`, `/usr/local/bin`, `~/.local/bin` when `Bun.which` fails (daemon PATH issue)
- oxlint forbids `!` non-null assertions — use `as T` with existence guards
- `@effect-diagnostics effect/nodeBuiltinImport:off` on files using raw `node:fs`/`node:path` (research domain, shared/executable)

## Skills

| Subcommand | Skill |
| ---------- | ----- |
| `okra schedule` | `skills/schedule/SKILL.md` |
| `okra counsel` | `skills/counsel/SKILL.md` |
| `okra research` | `skills/research/SKILL.md` |
