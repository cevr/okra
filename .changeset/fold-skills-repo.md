---
"@cvr/okra": minor
---

Add skills and repo as okra subcommands

- `okra skills` — manage AI agent skills from GitHub repos (add, search, remove, update)
- `okra repo` — multi-registry source code cache manager (fetch, list, remove, clean, path)
- All domains now use command-level layer provision via `Command.provide`
- FetchHttpClient added to global platform layer
- Unified error handling with centralized `tapCause` in main.ts
