---
"@cvr/okra": minor
---

Skills CLI: variadic args, aliases, multi-select prompt

- `okra skills add` and `okra skills remove` now accept multiple sources/names in one invocation (e.g. `okra skills add owner/a owner/b ./local`).
- Aliases: `add` ↔ `i` ↔ `install`, `remove` ↔ `rm` ↔ `uninstall`.
- When a repo or local folder contains multiple skills, an interactive multi-select prompt lets you choose which to install (single-skill paths still install directly).
- Dropped the redundant `--skill/-s` flag (the existing `owner/repo@skill` syntax already covers it).

Internal: bumped `effect` and `@effect/platform-bun` from `4.0.0-beta.31` to `4.0.0-beta.60`. Includes the `ServiceMap` → `Context` rename across all service definitions and a few smaller v4 beta API fixes (`FileSystem.File.Info.mtime` is now `Option<Date>`).
