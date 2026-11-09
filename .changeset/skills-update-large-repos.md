---
"@cvr/okra": patch
---

Fix `okra skills update` hanging on skills from very large repositories: a skill's files now load only the git trees on its own path instead of walking the whole repository one request at a time, and discovery falls back to directory listings. Every GitHub request (gh or HTTP) now times out after 30 seconds, and gh runs with prompts disabled.
