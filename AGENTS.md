# okra

AI agent orchestration toolkit, written in [Ergo](https://github.com/cevr/ergo)
and shipped as a native binary. The compiler pin is `ergo-toolchain.json`.

## Commands

```bash
ERGO=/path/to/ergo bun run build   # bin/okra-ergo and bin/okra-ergo-parity
bun run dev                        # build, then run bin/okra
bun parity/run.ts                  # keys and how; see README.md for every suite
bun scripts/release.ts             # the four native binaries in npm/
```

## Layout

See `ergo/README.md`. A package per responsibility (`keys`, `repo`, `skills`,
`image`, `counsel`, `schedule`, `how`); providers live in packages named after
their dependency (`keyfile`, `cachefile`, `registryhttp`, `imagehttp`,
`taskfile`, `launchd`, `agentexec`, `memory`). `ergo/cmd/okra/main.ergo` is the
only place that binds them; `ergo/cmd/okra-parity` binds the offline fakes.

## Parity

The parity suites (`parity/`) run the binary against offline fakes and compare
its output, status and files with the TypeScript CLI's, recorded in
`parity/frozen` before that source was removed (owner, 2026-11-15). Declared
differences are in `parity/routing.md` and `parity/declared-differences.md`;
the mutant ledgers are `parity/*MUTANTS.md`.

## Skills

| Subcommand      | Skill                      |
| --------------- | -------------------------- |
| `okra schedule` | `skills/schedule/SKILL.md` |
| `okra counsel`  | `skills/counsel/SKILL.md`  |
| `okra repo`     | `skills/repo/SKILL.md`     |
| `okra skills`   | `skills/skills/SKILL.md`   |
| `okra image`    | `skills/image/SKILL.md`    |
| `okra keys`     | `skills/keys/SKILL.md`     |
| `okra` (TOC)    | `skills/okra/SKILL.md`     |

`okra how <topic>` prints a skill's SKILL.md body; `scripts/guides.ts` embeds
them at build time in the order above.
