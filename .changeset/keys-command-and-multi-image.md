---
"@cvr/okra": minor
---

Add the `okra keys` command and multi-image output for `okra image`.

- **`okra keys` — centralized API-key management.** A new top-level command over the shared `KeyStoreService`: `okra keys set <provider> [<key>] [--stdin]`, `okra keys list` (prints provider **names** only, never values), `okra keys get <provider>` (a masked presence check — shows `sk-pr…1234 (stored)` or `(env OPENAI_API_KEY)`, exits 1 with `NOT_FOUND` when unset), and `okra keys rm <provider>`. `set` merges into `~/.okra/keys.json` (0600), so providers don't clobber each other. The key store gained `list`, `remove`, and `describe` methods alongside `resolve`/`store`.
- **Removed `okra image set-key`.** Key management is now centralized in `okra keys` — store the OpenAI key with `okra keys set openai <key>` (or `--stdin`). Resolution precedence is unchanged: env `OPENAI_API_KEY` > stored key.
- **`--n` writes every image.** The OpenAI Images path now returns all generated images instead of just the first. With `--n > 1`, files are suffixed before the extension (`out.png` → `out-1.png`, `out-2.png`, …); a single image keeps the bare path. stdout lists every saved path, one per line. The codex backend always produces exactly one image.
