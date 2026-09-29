---
"@cvr/okra": minor
---

`okra skills update --json` prints one JSON report on stdout: `outdated` skills with their lock source, skill path, and whether the source moved; `failed` skills with their source and reason; and the `unchanged` count. With `--dry-run` it reports what would change; without it, what changed.
