---
name: repo
description: Multi-registry source code cache manager CLI. Use when exploring external repos/packages — fetch, search, read code from GitHub/npm/PyPI/Crates. Triggers on "repo", "okra repo fetch", "okra repo path", "explore repo", "fetch repo", external repo analysis, or when needing to read source from another project.
---

# repo

Fetch and explore source code from GitHub, npm, PyPI, and Crates. Local cache at `~/.cache/repo/`.

## Navigation

```
What do you need?
├─ Fetch a repo/package        → §Fetching
├─ Check if already cached     → §Quick Lookup
├─ Search cached code          → §Search Tools
├─ Manage the cache            → §Cache Management
└─ Troubleshooting             → §Gotchas
```

## Quick Reference

| Command                      | What it does                                                        |
| ---------------------------- | ------------------------------------------------------------------- |
| `okra repo fetch <spec>`          | Fetch/update. stdout = path, stderr = progress. `--json`, `--force` |
| `okra repo path <spec>`           | Pure cache lookup. stdout = path, nonzero on miss. No network.      |
| `okra repo list`                  | List cached repos. `--registry`, `--sort`, `--json`                 |
| `okra repo remove <spec>`         | Remove from cache                                                   |
| `okra repo clean --days N`        | Prune by age                                                        |
| `okra repo clean --max-size 100M` | Prune by size                                                       |
| `okra repo clean --all -y`        | Remove everything                                                   |
| `okra repo clean --dry-run`       | Preview what would be removed                                       |

### Spec Formats

| Format | Example                                |
| ------ | -------------------------------------- |
| GitHub | `owner/repo`, `owner/repo@v1.0.0`      |
| npm    | `npm:lodash`, `npm:@effect/cli@0.73.0` |
| PyPI   | `pypi:requests@2.31.0`                 |
| Crates | `crates:serde@1.0.0`                   |

## Fetching

```bash
# Fetch a repo (prints path to stdout)
okra repo fetch vercel/next.js

# Compose with shell
cd $(okra repo fetch effect-ts/effect-smol)

# Force re-clone
okra repo fetch -f owner/repo

# JSON output (path, size, ref, fresh)
okra repo fetch --json owner/repo
```

stdout = path only. All status/progress goes to stderr. This makes piping work.

## Quick Lookup

```bash
# Instant check, no network
okra repo path owner/repo
# Exit 0 + path on stdout if cached, nonzero if not
```

## Cache Layout

| Registry | Path                                |
| -------- | ----------------------------------- |
| GitHub   | `~/.cache/repo/{owner}/{repo}`      |
| npm      | `~/.cache/repo/{package}/{version}` |
| PyPI     | `~/.cache/repo/{package}/{version}` |
| Crates   | `~/.cache/repo/{crate}/{version}`   |

## Search Tools

### ripgrep (rg)

```bash
rg "pattern" ~/.cache/repo/{owner}/{repo}
rg "pattern" -C 3 --type ts ~/.cache/repo/{owner}/{repo}
rg --files ~/.cache/repo/{owner}/{repo} | rg "filename"
```

### ast-grep — structural code search

```bash
ast-grep --pattern 'console.log($$$)' --lang ts ~/.cache/repo/{owner}/{repo}
ast-grep --pattern 'import { $$$ } from "$MOD"' --lang ts ~/.cache/repo/{owner}/{repo}
```

Use ast-grep for function/method definitions, import statements, class definitions, specific code structures.

### fd — file finder

```bash
fd "pattern" ~/.cache/repo/{owner}/{repo}
fd -e ts ~/.cache/repo/{owner}/{repo}
```

### Exploration strategy

| Scope             | Tool                             |
| ----------------- | -------------------------------- |
| Broad exploration | Explore agent on the cached path |
| Text patterns     | `rg` (ripgrep)                   |
| Code structures   | `ast-grep`                       |
| File names        | `fd` or Glob tool                |
| Specific files    | Read tool with full path         |
| Directory tree    | `eza --tree` on okra repo path        |

## Cache Management

```bash
# List everything
okra repo list
okra repo list --json
okra repo list -r npm              # filter by registry
okra repo list -s size             # sort by size/date/name

# Remove one
okra repo remove owner/repo

# Prune old/large
okra repo clean --days 30          # not accessed in 30 days
okra repo clean --max-size 1G      # larger than 1GB
okra repo clean --days 30 --dry-run

# Nuke
okra repo clean --all -y
```

## Typical Workflow

```bash
# 1. Fetch
okra repo fetch effect-ts/effect-smol

# 2. Get path
REPO=$(okra repo path effect-ts/effect-smol)

# 3. Explore
Read file_path="$REPO/package.json"
rg "ServiceMap" $REPO/packages --type ts -C 2
ast-grep --pattern 'class $NAME extends ServiceMap.Service<$$$>()($$$) { $$$ }' --lang ts $REPO

# 4. Or use Explore agent
Agent subagent_type="Explore" prompt="Explore $REPO to understand the service pattern..."
```

## Gotchas

- `okra repo fetch` always refreshes git repos on fetch (pull latest)
- `okra repo path` does zero network I/O — pure metadata lookup
- stdout/stderr discipline: never parse stderr, only stdout has data
- `okra repo list --json` returns `{ repos: [...], total, totalSize }` — useful for programmatic queries
- Size formats for `--max-size`: `100M`, `1G`, `500KB`
