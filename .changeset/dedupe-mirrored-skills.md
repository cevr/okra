---
"@cvr/okra": patch
---

Deduplicate provider-specific copies of the same skill during GitHub repository discovery.

`okra skills add owner/repo` now presents each installable skill once and prefers the portable root layout, then `.agents/skills`, when repositories publish mirrored variants for multiple agent harnesses.
