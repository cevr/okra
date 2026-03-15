# okra

AI agent orchestration toolkit. Four subcommands:

- **`okra schedule`** — Schedule AI agent tasks via macOS launchd
- **`okra counsel`** — Route prompts between Claude and Codex for second opinions
- **`okra research`** — Autonomous experiment daemon that optimizes measurable metrics
- **`okra brain`** — Persistent agent memory vault with AI-powered maintenance

## Install

```bash
bun install
bun run build
```

Binary compiles to `bin/okra` and symlinks to `~/.bun/bin/okra`.

## Usage

```bash
# Schedule a recurring agent task
okra schedule "babysit this pr" -s "every weekday at 9am"

# Get a second opinion from the opposite agent
okra counsel "Review the auth refactor for blind spots"

# Run an optimization experiment
okra research start --direction min --benchmark "bun run bench.ts" --objective "Minimize runtime"

# Initialize and manage agent memory
okra brain init
okra brain daemon start
```

## Development

```bash
bun run gate    # typecheck + lint + fmt + test + build (parallel)
bun run dev     # run from source
bun test        # tests only
```

## Stack

Effect v4 (beta.31), Bun, `effect/unstable/cli`, oxlint, oxfmt, lefthook.
