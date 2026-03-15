---
name: counsel
description: Route a prompt to the opposite local coding agent. Use when in Claude and wanting Codex, or in Codex and wanting Claude, for an independent second opinion on code, architecture, bugs, migrations, or tests. Triggers on "counsel", "ask codex", "ask claude", "second opinion", "route to the other model", "okra counsel".
---

# okra counsel

One command. Opposite agent only. For a tight second opinion, not an agent orchestra.

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
| `okra counsel --deep "prompt"` | Use deeper profile (opus/xhigh) |
| `okra counsel --from claude "prompt"` | Force source when auto-detection is ambiguous |
| `okra counsel --dry-run "prompt"` | Preview resolved invocation |

## When to Use

- You are in Claude and want Codex to challenge your read (or vice versa)
- You want one clean second opinion, not parallel fanout
- You already know the focus area and can write a direct prompt

Do not use when you need iterative rounds, tool selection, or group orchestration.

## Prompt Shape

Gather context first. Then send a tight prompt.

- Name the concrete question
- Reference exact files or directories
- Include constraints that matter
- Ask for receipts, not vibes

Good: `Review src/auth/ for regression risk after the token refresh refactor. Ground every claim in file paths.`

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
  program.ts         # pre-validation, -V alias, JSON error envelope
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
- `--deep` uses opus (Claude) or xhigh reasoning effort (Codex)
- Standard profile uses sonnet (Claude) or medium reasoning effort (Codex)
- Claude invocation includes `--tools` and `--allowedTools` restricted to read-only tools
