---
name: brain
description: Persistent agent memory vault managed by `okra brain`. Use when writing to brain, reading vault files, checking vault status, running daemon, or any interaction with the `~/.brain/` vault. Triggers on "brain", "add to brain", "write to brain", "vault", "brain status", "brain daemon", "daemon start", "daemon stop", "okra brain".
---

# okra brain

Global Obsidian-compatible vault for persistent agent memory across sessions. `okra brain` handles all filesystem plumbing — path resolution, vault init, index maintenance, hook wiring.

The brain is the foundation of the entire workflow — every agent, skill, and session reads it. Low-quality or speculative content degrades everything downstream. Before adding anything, ask: "Does this genuinely improve how the system operates?" If the answer isn't a clear yes, don't write it.

## Navigation

```
What do you need?
├─ CLI command reference        → §Quick Reference
├─ Read vault files             → §Reading
├─ Write vault files            → §Writing
├─ Understand vault structure   → §Vault Structure
├─ Maintain vault health        → §Maintenance
└─ Troubleshooting              → §Gotchas
```

## Quick Reference

| Command | What it does |
| ------- | ------------ |
| `okra brain vault` | Print active vault path (pipeable) |
| `okra brain vault --json` | `{ global, project, active }` |
| `okra brain inject` | Print vault index (SessionStart hook) |
| `okra brain reindex [--all]` | Rebuild `index.md` from disk (no-op if unchanged) |
| `okra brain status [--json]` | File count, sections, orphans |
| `okra brain init [--project] [--global]` | Scaffold vault, write config, wire hooks |
| `okra brain snapshot <dir> [-o file]` | Concatenate `.md` files with `=== path ===` delimiters |
| `okra brain extract <dir> <output> [-b N]` | Parse JSONL conversations into batched text files |
| `okra brain list [--json]` | List all vault files (one per line) |
| `okra brain daemon start` | Install unified scheduler (auto-migrates legacy plists) |
| `okra brain daemon stop` | Uninstall daemon scheduler |
| `okra brain daemon status [--json]` | Show scheduler state and per-job last run times |
| `okra brain daemon tick` | Scheduler tick — dispatches job based on current day/hour |
| `okra brain daemon run <job>` | Run a specific job immediately (reflect/ruminate/meditate) |
| `okra brain daemon logs [job] [--tail]` | View daemon logs (optional job as positional arg) |

## Vault Structure

```
~/.brain/                    # global vault (always active)
├── index.md                 # auto-maintained root index (wikilinks by section)
├── principles.md            # categorized principle index
├── principles/              # one file per engineering principle
├── plans/
│   └── index.md             # plan index
└── projects/                # per-project namespaces (auto-detected by git root / cwd)
    ├── bite/                # e.g. project-specific notes
    └── okra/                # e.g. project-specific notes for this repo
```

**Multi-vault**: global (`~/.brain/`) always active. `okra brain inject` auto-detects the current project (via `BRAIN_PROJECT` env, git root basename, or cwd basename) and injects notes from `projects/<name>/` alongside the global index.

**Hooks**: `SessionStart` runs `okra brain inject`. `PostToolUse` (matcher: `brain/`) runs `okra brain reindex`.

**Index rules**: `brain/index.md` is fully managed by `okra brain reindex` — regenerated from disk on every run. Every brain file must be reachable from it.

## Reading

Read `brain/index.md` first. Then read the relevant entrypoint for your topic.

```bash
VAULT=$(okra brain vault)
cat "$VAULT/index.md"
cat "$VAULT/principles/guard-the-context-window.md"
rg "pattern" "$VAULT"
okra brain status
```

## Writing

### Before writing

Read `brain/index.md` and the relevant entrypoint. Scan nearby files — prefer editing existing notes over creating new ones.

### Durability test

"Would I include this in a prompt for a different task?"

- **Yes** → brain
- **No, plan-specific** → `$(okra brain vault)/plans/`
- **No, skill-specific** → the skill file
- **No, follow-up** → backlog

### File conventions

- One topic per file, lowercase-hyphenated: `guard-the-context-window.md`
- Bullets over prose. No preamble. Plain markdown with `# Title`
- Keep notes under ~50 lines. Split if longer
- Wikilinks: `[[section/file-name]]`

### After writing

- Update `brain/index.md` for any files added or removed (or let PostToolUse hook handle it)
- Keep indexes link-only and scannable

## Maintenance

- Delete outdated notes before adding new ones
- Merge overlapping notes rather than creating near-duplicates
- `okra brain status` shows orphans (files not linked from any index)
- Run `okra brain reindex` to rebuild index from disk

## Gotchas

- `okra brain reindex` is a no-op if nothing changed — silence is success
- `okra brain init` is idempotent — safe to re-run
- The PostToolUse hook matcher is `brain/` — fires on any tool output containing that string
- `okra brain vault` returns the project vault if inside one, otherwise global
- Hooks wired into `~/.claude/settings.json` — existing hooks preserved
- `okra brain inject` is resilient — prints warning to stderr and exits 0 when vault is missing

## Daemon

Automated vault maintenance via launchd (**macOS-only**). Single unified plist (`com.cvr.okra.brain-daemon`) fires at 9am, 1pm, 5pm, 9pm.

| Timeslot | Sun | Mon-Thu | Fri-Sat |
| -------- | --- | ------- | ------- |
| 9am | meditate | ruminate | skip |
| 1pm | reflect | reflect | skip |
| 5pm | reflect | reflect | skip |
| 9pm | reflect | reflect | skip |

| Job | Model | What |
| --- | ----- | ---- |
| reflect | sonnet | Pass session file paths to Claude per project |
| ruminate | opus | Mine session archives for missed patterns |
| meditate | opus | Audit + prune + distill vault quality |

**State**: `~/.brain/.daemon.json`. **Locks**: `~/.brain/.daemon-{job}.lock` (O_EXCL).
**Logs**: `~/.brain/logs/`. Size-based rotation (>10MB → last 1000 lines).

## Architecture

```
src/brain/
  errors/index.ts          # BrainError, VaultError, ConfigError
  services/
    Config.ts              # vault paths, config file, project detection
    Vault.ts               # vault init, reindex, status, snapshot, listing
    BuildInfo.ts           # compile-time __ASSET_ROOT__ + __VERSION__
    Claude.ts              # Claude settings.json management
    AgentPlatform.ts       # multi-provider detection + invocation
  commands/
    init.ts                # vault scaffold, hook wiring, starter principles
    inject.ts              # SessionStart hook output
    reindex.ts             # rebuild index.md
    status.ts              # vault health
    vault.ts               # print vault path
    list.ts                # list vault files
    snapshot.ts            # concatenate .md files
    extract.ts             # JSONL conversation mining
    daemon.ts              # daemon parent + subcommands
    daemon/
      schedule.ts          # pure resolveJob (no Effect deps)
      state.ts             # DaemonState r/w, locks
      reflect.ts           # session scanning + AI invocation
      ruminate.ts          # deep archive mining
      meditate.ts          # vault quality audit
      launchd.ts           # plist generation, install/uninstall
```
