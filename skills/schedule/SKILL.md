---
name: schedule
description: AI agent task scheduler via macOS launchd. Use when scheduling agent tasks, managing scheduled jobs, viewing task logs, or any interaction with `~/.okra/schedule/`. Triggers on "schedule agent", "schedule task", "agent scheduler", "launchd agent", "okra schedule".
---

# okra schedule

Schedule AI agent tasks (Claude, Codex) via macOS launchd. Each task becomes a plist that fires `okra schedule run <id>`, invoking the agent in the original working directory.

## Navigation

```
What do you need?
├─ Schedule a task           → §Scheduling
├─ Manage existing tasks     → §Management
├─ View logs                 → §Logs
├─ Understand internals      → §Architecture
└─ Troubleshooting           → §Gotchas
```

## Quick Reference

| Command | What it does |
| ------- | ------------ |
| `okra schedule "<prompt>" -s "<schedule>"` | Schedule task (default: claude) |
| `okra schedule "<prompt>" -s "<schedule>" -p codex` | Schedule with specific provider |
| `okra schedule "<prompt>" -s "<schedule>" --stop-when "<condition>" --max-runs N` | Conditional stop with fallback |
| `okra schedule list` | List all tasks |
| `okra schedule list -j` | List tasks as JSON |
| `okra schedule remove <id>` | Remove task + unload plist |
| `okra schedule run <id>` | Execute task (called by launchd) |
| `okra schedule logs` | List available logs |
| `okra schedule logs <id>` | View task log |
| `okra schedule logs <id> -f` | Tail task log |

## Scheduling

### Schedule Formats

Natural language (preferred):

| Pattern | Type | Example |
| ------- | ---- | ------- |
| `in N minutes/hours/days` | Oneshot | `in 30 minutes` |
| `tomorrow at HH:mm[am\|pm]` | Oneshot | `tomorrow at 9am` |
| `every day at HH:mm[am\|pm]` | Recurring | `every day at 9:00` |
| `every weekday at HH:mm` | Recurring | `every weekday at 9am` |
| `every {day} at HH:mm` | Recurring | `every monday at 10:30am` |

5-field cron fallback: `min hour dom month dow`

### Providers

| Flag | CLI invoked |
| ---- | ----------- |
| `-p claude` (default) | `claude -p <prompt> --dangerously-skip-permissions --model sonnet` |
| `-p codex` | `codex exec -C <cwd> --dangerously-bypass-approvals-and-sandbox` |

## Context Metadata

At creation, captures git/gh context (best-effort, all optional): branch, remote URL, repo name, commit, default branch, PR number/URL, issue number (from branch pattern).

At invocation, context injected as `<context>` block prepended to prompt. Enables natural prompts like `"babysit this pr"`.

## Conditional Stops

`--stop-when` lets the agent signal "I'm done" based on a natural language condition. Requires a deterministic fallback (`--max-runs` or `--until`).

```bash
okra schedule "babysit pr" -s "every day at 9am" --stop-when "the PR is merged" --max-runs 20
```

**Flow:** nonce injection → signal detection in output → verification call → complete or continue.

## Management

- Tasks stored at `~/.okra/schedule/tasks/{id}.json`
- Plists at `~/Library/LaunchAgents/com.cvr.okra.schedule-{id}.plist`
- `rm` unloads plist, deletes task file, cleans log
- Oneshot tasks auto-complete after first run
- `install` is atomic: rolls back to previous plist if `launchctl load` fails

## Logs

- Log files at `~/.okra/schedule/logs/{id}.log`
- Both stdout and stderr go to the same log file

## Architecture

```
src/schedule/
  errors.ts                  # ScheduleError (tagged, string code)
  paths.ts                   # ~/.okra/schedule/ path resolution
  context.ts                 # git/gh context capture + prompt injection
  commands/
    index.ts                 # root (= add) + subcommands
    list.ts, remove.ts, run.ts, logs.ts
  services/
    Schedule.ts              # pure NL/cron parser
    Store.ts                 # task CRUD
    StopEvaluator.ts         # pure deterministic stop evaluation
    Launchd.ts               # plist gen + launchctl (atomic install/uninstall)
    AgentPlatform.ts         # agent invocation (capture+tee stdout)
    Verification.ts          # conditional stop verification
```

## Gotchas

- `Schedule` and `StopEvaluator` are pure modules, not `ServiceMap.Service`
- Task IDs: alphanumeric, hyphens, underscores only
- Weekday range `1-5` expands to 5 separate `StartCalendarInterval` entries
- `PathEnv` inherits `process.env.PATH` at build time
- `--stop-when` requires `--max-runs` or `--until` — error code `MISSING_FALLBACK`
- `generatePlist` and `escapeXml` are `@internal` exports for testability
