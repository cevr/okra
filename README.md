# okra

AI agent orchestration toolkit. Seven subcommands:

- **`okra schedule`** — Schedule AI agent tasks via macOS launchd
- **`okra counsel`** — Route prompts between Claude and Codex for second opinions
- **`okra repo`** — Multi-registry source code cache for exploring external repos
- **`okra skills`** — Manage AI agent skills from GitHub repos or local paths
- **`okra image`** — Generate or edit images via codex or the OpenAI Images API
- **`okra keys`** — Manage stored provider API keys
- **`okra how`** — Print the embedded usage guide for any subcommand

okra is written in [Ergo](https://github.com/cevr/ergo) and ships as a native
binary. The TypeScript source in `src/` is the reference implementation: the
parity suites run both programs and require the same output. It stays until it
is retired.

## Install

```bash
bun add --global @cvr/okra    # or: npm install --global @cvr/okra
```

The package carries native binaries for macOS and Linux (arm64 and x64) and a
small `sh` launcher, `bin/okra`, that runs the one for your platform. It has no
postinstall step and needs no Bun or Node at run time.

From a source checkout, build the compiler at the pin in `ergo-toolchain.json`
(`go build ./cmd/ergo` in a checkout of that commit), then:

```bash
bun install
ERGO=/path/to/ergo bun run build:ergo   # bin/okra-ergo and the offline parity entry
ln -sf "$PWD/bin/okra" ~/.bun/bin/okra
```

`OKRA_IMPL=ts okra …` runs the TypeScript build (`bun run build`) instead, in a
source checkout only.

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

# Generate through the ChatGPT subscription (the Codex backend picks the image model)
okra image "an okra botanical illustration" -o okra.png

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
bun run dev     # build the Ergo binary and run it
bun test        # tests of the TypeScript reference
```

Ergo port (`ergo/`, see [ergo/README.md](ergo/README.md)) and its parity
suites, with `ERGO` naming the pinned compiler:

```bash
bun scripts/build.ts && bun scripts/build.ts --ergo   # both programs
bun parity/run.ts            # keys, how
bun parity/repo.ts --seed=42 # repo; likewise skills, image, counsel, schedule, until
bun scripts/release.ts       # the four native binaries the package ships, in npm/
bun scripts/smoke.ts         # pack, install with bun and npm, run the installed okra
```

CI (`.github/workflows/ci.yml`) builds the pinned compiler and runs every parity
suite; the release workflow builds the binaries on Linux and macOS runners.

## Stack

Ergo (native binary), with the TypeScript reference on Effect 4, Bun and
`effect/cli`; oxlint, oxfmt, lefthook.
