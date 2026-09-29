---
"@cvr/okra": minor
---

`okra skills` records local sources under `$HOME` as `local:~/path` and expands `~` on update, so one skill lock works across machines. `okra skills update` now reports a missing local source as a failure instead of deleting the installed skill and its lock entry.
