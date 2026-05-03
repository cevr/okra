---
"@cvr/okra": minor
---

Skills add: live per-skill progress UI

`okra skills add` now renders the same live spinner-per-skill progress UI as `okra skills update`. After discovery and any selection prompts complete, all installations run in parallel under a progress display showing pending → installing → installed/failed. In non-TTY environments, terminal statuses print inline as they complete.

The progress controller (`src/skills/lib/progress.ts`) was made fully testable by injecting `tty` and `write` overrides via `MakeOptions`, with tests covering both TTY and non-TTY rendering paths, ANSI escape sequences, and ticker fiber lifecycle.
