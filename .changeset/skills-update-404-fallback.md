---
"@cvr/okra": minor
---

**skills:** auto-recover `skillPath` when an upstream skill moves within its source repo.

When `okra skills update` 404s fetching a skill's directory (e.g. `mattpocock/skills` moved `handoff` from `skills/in-progress/` to `skills/productivity/`), the updater now falls back to `discoverSkills` on the repo, matches by leaf dirname, refetches from the new location, and rewrites the lock entry's `skillPath` in the batched lock write. Surfaces as a new `moved` status in the per-skill progress UI.
