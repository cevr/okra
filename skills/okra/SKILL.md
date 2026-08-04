---
name: okra
description: Table of contents for the okra CLI (AI agent orchestration toolkit). Use whenever a task involves an okra subcommand — schedule, counsel, repo, skills, image, keys — to pull the authoritative guide instead of guessing flags. Triggers on "okra", "okra how", or any okra subcommand name.
---

# okra

okra ships its own documentation. Do not guess flags or workflows — pull the guide from the
binary, which is always in sync with the installed version:

```bash
okra how              # list all topics with one-line summaries
okra how <topic>      # print the full guide for one topic
```

## Topics

| Topic      | Use for                                                                 |
| ---------- | ----------------------------------------------------------------------- |
| `schedule` | Run prompts on recurring launchd timers                                 |
| `counsel`  | Route a prompt to the opposite local coding agent (Claude ↔ Codex)      |
| `repo`     | Fetch, cache, and read external repos/packages (GitHub/npm/PyPI/Crates) |
| `skills`   | Manage installed agent skills                                           |
| `image`    | Generate or edit images (codex backend or OpenAI Images API)            |
| `keys`     | Store and inspect provider API keys (`~/.okra/keys.json`)               |

## Workflow

1. Run `okra how <topic>` before the first use of a subcommand in a session.
2. Follow that guide's quick-reference table; it is the same content as the per-topic skill.
