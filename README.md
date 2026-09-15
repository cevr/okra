# okra

AI agent orchestration toolkit. Seven subcommands:

- **`okra schedule`** — Schedule AI agent tasks via macOS launchd
- **`okra counsel`** — Route prompts between Claude and Codex for second opinions
- **`okra repo`** — Multi-registry source code cache for exploring external repos
- **`okra skills`** — Manage AI agent skills from GitHub repos or local paths
- **`okra image`** — Generate or edit images via codex or the OpenAI Images API
- **`okra keys`** — Manage stored provider API keys
- **`okra how`** — Print the embedded usage guide for any subcommand

## Install

```bash
bun add --global @cvr/okra
```

Bun links the package entry point to `~/.bun/bin/okra`.

## Usage

```bash
# Schedule a recurring agent task
okra schedule "babysit this pr" -s "every weekday at 9am"

# Get a second opinion from the opposite agent
okra counsel "Review the auth refactor for blind spots"

# Install skills (variadic, multi-select for multi-skill repos)
okra skills add owner/repo                # all skills (multi-select prompt)
okra skills add owner/repo@name           # specific skill
okra skills add ~/path/to/skill           # local path
okra skills i owner/a owner/b ./local     # alias `i`, multiple at once
okra skills rm my-skill                   # alias `rm` for remove

# Generate with GPT Image 2.5 through the ChatGPT subscription
okra image "an okra botanical illustration" -o okra.png
okra image "a detailed product illustration" --image-model gpt-image-2.5-sunburst

# Use the paid Images API explicitly
okra image "a landscape" --model gpt-image-2.5-flare --quality max

# Cache an external repo for exploration
okra repo fetch effect-ts/effect-smol
okra repo path effect-ts/effect-smol
```

## Development

```bash
bun install     # install dependencies
bun run gate    # typecheck + lint + fmt + test + build (parallel)
bun run dev     # run from source
bun test        # tests only
```

## Stack

Effect v4 (rc.115), Bun, `effect/unstable/cli`, oxlint, oxfmt, lefthook.
