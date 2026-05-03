---
"@cvr/okra": minor
---

Skills update: live per-skill progress UI

`okra skills update` now renders a live progress line per skill with a spinner while updating, and updates each line in place as results come in instead of printing a batched summary at the end. Each skill shows pending → updating → updated/unchanged/removed/failed with a status glyph and color.

In non-TTY environments (CI, piped output), it falls back to printing each terminal status inline as it completes — preserving scriptable output.
