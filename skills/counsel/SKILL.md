---
name: counsel
description: Route a prompt to the opposite local coding agent. Use when in Claude and wanting Codex, or in Codex and wanting Claude, for a second opinion, help, guidance, code review, brainstorming, or any task you'd delegate to the other model. Triggers on "counsel", "ask codex", "ask claude", "second opinion", "get help from", "route to the other model", "okra counsel".
---

# okra counsel

One command. Opposite agent. For delegating any task — review, help, exploration, brainstorming — to the other local coding agent.

## Navigation

```
What do you need?
├─ Quick command shape        → §Quick Reference
├─ When to use it             → §When to Use
├─ How to prepare the prompt  → §Prompt Shape
├─ How to run it              → §Workflow
└─ What files to read after   → §Output
```

## Quick Reference

| Command | What it does |
| ------- | ------------ |
| `okra counsel "prompt"` | Send inline prompt to opposite agent |
| `okra counsel -f prompt.md` | Send a prompt file |
| `echo "prompt" \| okra counsel` | Send stdin |
| `okra counsel --deep "prompt"` | Use deeper profile (opus/max effort) |
| `okra counsel --from claude "prompt"` | Force source when auto-detection is ambiguous |
| `okra counsel --dry-run "prompt"` | Preview resolved invocation |

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
3. Run `okra counsel`
4. Read stdout payload first, then the target output file

## Output

Each run writes a directory under `/tmp/counsel/<slug>/`:

```
prompt.md
claude.md or codex.md
claude.stderr or codex.stderr
```

Read order: stdout payload → `<target>.md` → `<target>.stderr` if error/timeout.

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
- Both profiles use opus for Claude; `--deep` sets `--effort max`, standard sets `--effort medium`
- Codex: `--deep` uses xhigh reasoning effort, standard uses medium
- Claude invocation includes `--tools` and `--allowedTools` restricted to read-only tools
