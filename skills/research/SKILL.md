---
name: research
description: Autonomous experiment daemon that optimizes any measurable metric using AI agents. Use when running optimization experiments, benchmarking code changes, managing experiment sessions, or any interaction with `.xp/` directories. Triggers on "research", "experiment", "optimize", "benchmark", "xp", "okra research".
---

# okra research

Autonomous experiment daemon. Feed it a benchmark and an objective — it loops an AI agent, keeps improvements, discards regressions.

## Navigation

```
What do you need?
├─ Start an experiment        → §Quick Start
├─ Monitor progress           → §Monitoring
├─ Guide the agent            → §Steering
├─ Understand the loop        → §Architecture
└─ Troubleshooting            → §Gotchas
```

## Quick Reference

| Command                                                                                          | What it does            |
| ------------------------------------------------------------------------------------------------ | ----------------------- |
| `okra research start --direction min --benchmark "bun run bench.ts" --objective "Optimize sort"` | Start experiment        |
| `okra research start`                                                                            | Resume existing session |
| `okra research stop`                                                                             | Stop daemon             |
| `okra research status`                                                                           | Show progress           |
| `okra research status --json`                                                                    | Machine-readable status |
| `okra research logs -f`                                                                          | Tail daemon log         |
| `okra research steer "Try a different algorithm"`                                                | Queue guidance          |
| `okra research results`                                                                          | Show all results        |
| `okra research results --last 5`                                                                 | Show last N results     |

## Quick Start

```bash
cd your-project
okra research start \
  --direction min \
  --benchmark "bun run bench.ts" \
  --objective "Minimize total runtime" \
  --unit ms
```

Required flags: `--direction`, `--benchmark`, `--objective`. Everything else optional.

### Benchmark Contract

Benchmark must emit exactly one `RESULT <number>` line to stdout:

```
RESULT 42.5
```

- Zero lines → error. Multiple → last value used.
- Regex: `^RESULT\s+([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)$`

### Budget Controls

| Flag               | Default | Effect                       |
| ------------------ | ------- | ---------------------------- |
| `--max-iterations` | 50      | Hard iteration cap           |
| `--max-failures`   | 5       | Consecutive failure cap      |
| `--max-minutes`    | none    | Wall-clock deadline          |
| `--until`          | none    | Absolute deadline (ISO date) |
| `--provider`       | claude  | Agent to use                 |

`--max-minutes` and `--until` are mutually exclusive; both normalize to absolute `deadline`.

## Monitoring

- `okra research status` — daemon running?, iteration count, baseline, best value, trial counts
- `okra research logs -f` — live daemon output
- `okra research results --last 5` — recent trial history
- `.xp/experiment.md` — auto-generated markdown summary

## Steering

```bash
okra research steer "Try a cache-based approach instead of sorting"
```

Writes a timestamped file to `.xp/steer/`. Loop consumes and deletes each iteration.

## Architecture

```
src/research/
  errors.ts           # ResearchError (literal code union, 20 codes)
  paths.ts            # .xp/ directory layout
  types.ts            # Session, JSONL events, BenchmarkResult, AgentResult
  scoring.ts          # compareMetrics, shouldKeep
  prompt.ts           # buildExperimentPrompt, buildSetupPrompt
  commands/
    start.ts, stop.ts, status.ts, logs.ts, steer.ts, results.ts, loop.ts
  services/
    AgentPlatform.ts   # invoke + ensureExecutable (uses shared resolveExecutable)
    Budget.ts          # iteration/failure/deadline checks
    Daemon.ts          # start/stop/status via pid file
    ExperimentLog.ts   # JSONL append + state reconstruction
    Git.ts             # all git operations (worktree, commit, revert, diff)
    Loop.ts            # core experiment loop (reconcile → baseline → iterate)
    Runner.ts          # benchmark execution (sh -c) + RESULT parsing
    Session.ts         # session.json CRUD
    Workspace.ts       # git worktree setup + setup manifest replay
```

### Loop Protocol

1. Startup: load session, reconcile pending state, setup worktree
2. Baseline: run benchmark on clean worktree, record value
3. Loop: budget check → consume steers → verify benchmark integrity → invoke agent → benchmark → keep/discard/fail
4. Two-phase commit: `result(pending)` → `committed(sha)` → `decision(kept|discarded|failed)`

### Data Layout (`.xp/`)

| File                | Purpose                   |
| ------------------- | ------------------------- |
| `session.json`      | Session config            |
| `experiments.jsonl` | Event source of truth     |
| `experiment.md`     | Auto-generated summary    |
| `setup.json`        | Worktree setup manifest   |
| `benchmark.digest`  | SHA256 of benchmark files |
| `daemon.pid`        | Running daemon PID        |
| `daemon.log`        | Daemon stdout/stderr      |
| `steer/`            | Pending user guidance     |
| `worktree/`         | Git worktree              |

## Gotchas

- `_loop` command guarded by `OKRA_INTERNAL=1` — internal use only
- Daemon spawns `[process.execPath, "research", "_loop", "--project-root", ...]`
- `git worktree prune` runs automatically in `Workspace.setup` — stale worktrees self-heal
- `okra research stop` cleans pid file but not worktree — intentional, preserves branch state
- Benchmark timeout: 5x baseline duration (min 30s)
- Agent timeout: 10min default, `--max-turns 20` for claude
- Revert semantics: `git reset --hard HEAD && git clean -fd`
- `ExperimentLog.reconstructState` skips malformed JSONL lines with a warning
