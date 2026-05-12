---
name: skills
description: Manage AI agent skills installed in $SKILLS_DIR (defaults to ~/Developer/personal/dotfiles/skills). Use when adding, installing, removing, uninstalling, searching, or updating skills from GitHub repos or local paths. Triggers on "okra skills", "install a skill", "add skill", "remove skill", "skills add", "skills i", "skills rm", "skills update".
---

# skills

Install and manage agent skill packages from GitHub or local paths. Skills land in `$SKILLS_DIR` (default `~/Developer/personal/dotfiles/skills`). State persists in a lockfile at `$SKILLS_DIR/.lock.json`.

## Quick Reference

| Command                        | What it does                                              |
| ------------------------------ | --------------------------------------------------------- |
| `okra skills`                  | List managed skills                                       |
| `okra skills add <source...>`  | Install one or more skills (aliases: `i`, `install`)      |
| `okra skills remove <name...>` | Uninstall one or more skills (aliases: `rm`, `uninstall`) |
| `okra skills search <query>`   | Search skills.sh for skills                               |
| `okra skills update`           | Re-fetch all installed skills from their sources          |

### Source Formats

| Source                                          | Behavior                                                         |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| `owner/repo`                                    | Discover skills in the repo. Multi-select prompt if >1 found.    |
| `owner/repo@name`                               | Install that specific skill.                                     |
| `owner/repo#ref`                                | Pin to a ref (branch/tag/sha).                                   |
| `https://github.com/owner/repo[/tree/ref/path]` | URL form, supports tree links.                                   |
| `./path` `~/path` `/abs/path`                   | Local folder. Multi-select prompt if folder has multiple skills. |
| anything else                                   | Treated as a search query against skills.sh.                     |

## Adding skills

```bash
# Single skill, GitHub
okra skills add owner/repo@my-skill

# Whole repo — multi-select prompt if >1 skill
okra skills add owner/repo

# Local folder — multi-select if multiple SKILL.md found in subdirs
okra skills add ./my-skills-dir

# Variadic — install many at once
okra skills add owner/a owner/b owner/c@named ./local

# Aliases
okra skills i owner/repo@name
okra skills install owner/repo@name
```

When a source resolves to multiple skills, an interactive `multiSelect` prompt opens. Single-skill sources install directly without a prompt.

## Removing skills

```bash
# By name
okra skills remove my-skill

# Variadic
okra skills remove a b c

# By local source path — removes every installed skill that came from that folder
okra skills remove ./my-skills-dir

# Aliases
okra skills rm my-skill
okra skills uninstall my-skill
```

## Updating

```bash
# Re-fetch every managed skill from its recorded source
okra skills update
```

For sources that no longer resolve (deleted local path, deleted repo), the lock entry and skill dir are pruned.

## Gotchas

- `$SKILLS_DIR` is read once at layer construction. Restart the process after changing it.
- Lock entries record the _resolved_ source (so `acme/repo@foo` stays as `acme/repo@foo` for updates).
- Skills installed from local paths use a `local:/abs/path` source — moving the source folder breaks `update`.
- Multi-skill repos: choose carefully. Picking nothing in the prompt aborts the install for that source.
- The `--skill/-s` flag was removed in favor of the `owner/repo@name` syntax.
