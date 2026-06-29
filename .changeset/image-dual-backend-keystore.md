---
"@cvr/okra": minor
---

Add the `okra image` command with two backends and a shared, multi-provider key store.

- **Dual backend, chosen by `--model`.** GPT-image / DALL·E models (`gpt-image-1.5`, `gpt-image-1`, `gpt-image-1-mini`, `dall-e-*`) route to the metered OpenAI Images API (`POST /images/generations`); every other model (default `gpt-5.5`) streams through the ChatGPT codex backend, reusing the `codex login` OAuth token. No separate `--backend` flag — the model id decides.
- **OpenAI image controls.** New optional flags surfaced for the OpenAI path: `--quality` (auto/low/medium/high), `--background` (auto/transparent/opaque), and `--n` (image count). They're ignored by the codex backend, which prints a note when they're passed.
- **Shared key store (`~/.okra/keys.json`).** A new generic, cross-domain `KeyStoreService` (in `src/shared/`) persists API keys by provider name as a flat JSON map (`{ "openai": "sk-..." }`), created `0600`. Resolution precedence is **env var > stored key**. Store the OpenAI key with `okra image set-key <key>` or `okra image set-key --stdin` (the latter keeps the key out of shell history). `set-key` merges into the existing map, so future providers can share the same file.
