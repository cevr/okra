---
name: counsel
description: Route a prompt to the opposite local coding agent. Use when in Claude and wanting Codex, or in Codex and wanting Claude, for a second opinion, help, guidance, code review, brainstorming, or any task you'd delegate to the other model. Triggers on "counsel", "ask codex", "ask claude", "second opinion", "get help from", "route to the other model", "okra counsel".
---

# okra counsel

One command. Opposite agent. For delegating any task — review, help, exploration, brainstorming — to the other local coding agent.

## From Claude Code: the codex mod

In Claude Code, when the `mcp__codex__start` tool is listed (the `codex` mod), use it in place of `okra counsel`. `okra counsel` stays the path from Codex to Claude, and the fallback when the mod's tools are missing.

- **Start:** `mcp__codex__start` with `model: "sol"` (the newest Sol), `effort: "medium"` (`"max"` where you would pass `--deep`), `sandbox: "read-only"` for advice or review, a short `description`, and the prompt (§Prompt Shape). Pass no `role`: a role carries an orchestrate unit's instructions.
- **Wait:** the call returns a thread id at once. The answer arrives as a message from the codex plugin when the turn ends. Go on with other work. Set no timer, and do not poll.
- **Follow up:** `mcp__codex__send` with the thread id. The thread keeps its context, so a follow-up or a next review round sends only what changed.
- **Check:** `mcp__codex__threads` lists this session's threads and whether each one runs.

## Navigation

```
What do you need?
├─ In Claude Code             → §From Claude Code: the codex mod
├─ Quick command shape        → §Quick Reference
├─ When to use it             → §When to Use
├─ How to prepare the prompt  → §Prompt Shape
├─ How to run it              → §Workflow
└─ What files to read after   → §Output
```

## Quick Reference

| Command                               | What it does                                  |
| ------------------------------------- | --------------------------------------------- |
| `okra counsel "prompt"`               | Send inline prompt to opposite agent          |
| `okra counsel -f prompt.md`           | Send a prompt file                            |
| `echo "prompt" \| okra counsel`       | Send stdin                                    |
| `okra counsel --deep "prompt"`        | Use deeper profile (Opus/max or Sol/max)      |
| `okra counsel --from claude "prompt"` | Force source when auto-detection is ambiguous |
| `okra counsel --dry-run "prompt"`     | Preview resolved invocation                   |

## When to Use

- **Second opinion** — challenge your own approach, adversarial review
- **Help & guidance** — ask the other agent for ideas, explanations, or suggestions
- **Code review** — get a fresh read on a diff, file, or module
- **Exploration** — brainstorm approaches, investigate options, research a question
- **Delegation** — hand off a self-contained task you don't want to do yourself

One clean shot. Not iterative rounds or multi-agent orchestration.

## Prompt Shape

Gather context first. Then send a tight prompt.

- Name the concrete question or task
- Reference exact files or directories
- Include constraints that matter
- Ask for receipts, not vibes

Good: `Review src/auth/ for regression risk after the token refresh refactor. Ground every claim in file paths.`
Good: `Help me understand how the scheduler reconciles missed runs. Read src/schedule/ and explain the flow.`
Good: `Brainstorm 3 approaches for migrating the store from JSON files to SQLite. Pros/cons for each.`

Bad: `Thoughts?`

## Workflow

1. Gather local context yourself first — counsel does not do discovery
2. Write the prompt inline, from a file, or through stdin
3. In Claude Code, start a Codex thread through the codex mod (§From Claude Code). Elsewhere, run `okra counsel`
4. The mod's answer comes as a message. For `okra counsel`, read the stdout payload first, then the target output file

## Output

Each run writes a directory under `/tmp/counsel/<slug>/`:

```
prompt.md
claude.md or codex.md
claude.stderr or codex.stderr
events.jsonl
manifest.json
```

`manifest.json` records the run: `status`, `model`, `failure`, `exitCode`, and `durationMs`. `model` is the model that answered: after a Codex fallback it names the fallback model, and for Claude it names the concrete model behind the alias (e.g. `claude-opus-5-5`).

Read order: stdout payload → `<target>.md` → `manifest.json` and `<target>.stderr` if error/timeout.

## Architecture

```
src/counsel/
  errors.ts          # CounselError (literal code schema)
  constants.ts       # timeouts, tool lists, sanitizePath
  types.ts           # Provider, Profile, RunManifest, DryRunPreview
  commands/index.ts  # command definition with all flags
  services/
    Host.ts              # cwd, env, stdin, exitCode
    AgentPlatform.ts     # source detection, invocation building
    InvocationRunner.ts  # child process spawn + stream piping
    Run.ts               # orchestration: resolve → build → execute
```

## Gotchas

- Fails if it cannot infer Claude vs Codex and `--from` is missing
- Writes files; does not stream the other model's answer back into active chat
- Exits 1 and prints `<target> failed: <reason>` on stderr when the other agent does not answer (usage limit, API error, no answer), even when that agent exits 0; the `.md` file is then empty
- Claude: both profiles use the `opus` alias (latest Opus): `--deep` at max effort, standard at medium effort
- Codex: standard uses the newest GPT Sol that the Codex account can use (models.dev release order, filtered by the Codex CLI model list, with a fallback to an older Sol on rejection) at medium effort; `--deep` uses the same model at max effort
- Claude invocation includes `--tools` and `--allowedTools` restricted to read-only tools
