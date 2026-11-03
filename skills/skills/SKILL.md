---
name: skills
description: Manage AI agent skills installed in $SKILLS_DIR (defaults to ~/Developer/personal/dotfiles/skills). Use when adding, installing, removing, uninstalling, searching, or updating skills from GitHub repos or local paths. Triggers on "okra skills", "install a skill", "add skill", "remove skill", "skills add", "skills i", "skills rm", "skills update".
---

# skills

Install and manage agent skill packages from GitHub or local paths. Skills land in `$SKILLS_DIR` (default `~/Developer/personal/dotfiles/skills`). State persists in a lockfile at `$SKILLS_DIR/.skill-lock.json`.

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

When a source resolves to multiple skills, an interactive `multiSelect` prompt opens. The prompt dims installed skills and keeps them unavailable for selection. A newly discovered single skill installs directly without a prompt.

GitHub discovery prefers a real `SKILL.md` over symlinked copies of the same skill. File and directory symlinks within a skill are installed as their target contents at the link's path. Targets must stay inside the same repository and exist in its tree; invalid or cyclic links fail that skill before its installed files are changed. Updates use the same resolution, including existing lock entries pointing at a symlinked copy.

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

# Check without writing: outdated skill names on stdout, progress on stderr
okra skills update --dry-run

# One JSON report on stdout: {dryRun, outdated:[{name,source,skillPath,moved}], failed:[{name,source,reason}], modified:[{name,source,reason}], unchanged}
okra skills update --dry-run --json

# Overwrite local edits in every managed skill
okra skills update --force
```

Add and update record a content `hash` in each lock entry. Before fetching a source, update compares the installed files with that baseline. A mismatch is reported as `modified` and skipped, including during `--dry-run`; its files and lock entry stay untouched. Move the edit to the recorded source, then use `--force` to accept the source version. Update takes no skill names, so `--force` applies to all managed skills. `--dry-run --force` previews that overwrite without writing anything.

Legacy entries without a hash get a baseline on their next update. If source and installed files match, only the lock entry is backfilled; files are not rewritten. If they differ, update replaces the files as before and warns that no baseline existed to detect local edits. Dry-run never writes the lock, including backfills.

The stable hash format is `sha256:<lowercase hex>`. Sort relative paths using `/` separators in JavaScript UTF-16 code-unit order (not locale order). For each file, concatenate UTF-8 path bytes, a NUL byte, the ASCII decimal content byte length, a NUL byte, and the raw content bytes; SHA-256 hashes the concatenation of those records. All installed files, including hidden files and nested files, participate; timestamps, permissions, and empty directories do not. Added, deleted, renamed, and binary-edited files therefore change the hash.

Per-skill `modified` and `failed` results both leave the command's exit code at 0, preserving the existing failure-reporting behavior. Scripts should inspect those JSON arrays. Command-level errors, such as an unreadable lock file, still fail the command.

A local source that is missing on this machine is reported as failed; the skill and its lock entry stay. Delete with `okra skills remove`. A skill whose directory moved within its GitHub repo is found and its path updated.
The terminal shows one live status line. Each completed skill prints one result line. Spinner ticks add no lines to terminal history. Piped output contains results without animation.

## Gotchas

- `$SKILLS_DIR` is read once at layer construction. Restart the process after changing it.
- Lock entries record the _resolved_ source (so `acme/repo@foo` stays as `acme/repo@foo` for updates).
- Local sources under `$HOME` are recorded as `local:~/path`, so one lock works on machines with different home directories. Moving the source folder breaks `update`.
- Multi-skill repos: choose carefully. Picking nothing in the prompt aborts the install for that source.
- The `--skill/-s` flag was removed in favor of the `owner/repo@name` syntax.
