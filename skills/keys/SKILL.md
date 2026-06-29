---
name: keys
description: Manage stored API keys for okra (the shared ~/.okra/keys.json secret store). Use to save, list, or remove a provider API key — e.g. the OpenAI key used by `okra image` GPT-image / DALL·E models. Triggers on "okra keys", "set api key", "store openai key", "list stored keys", "remove api key", "where is my api key stored".
---

# keys

Centralized management of the API keys okra persists in `~/.okra/keys.json` — a generic,
multi-provider map (`{ "openai": "sk-...", "anthropic": "sk-..." }`) written `0600`. Keys are
addressed by a **provider name**. Any okra domain that needs an API key resolves it from here,
with the rule **environment variable > stored key**.

## Quick Reference

| Command                                         | What it does                                                  |
| ----------------------------------------------- | ------------------------------------------------------------- |
| `okra keys set <provider> <key>`                | Store a key for a provider (merges; other keys preserved)     |
| `echo $KEY \| okra keys set <provider> --stdin` | Store a key from stdin (avoids shell history)                 |
| `okra keys list`                                | Print stored provider **names** (never values), one per line  |
| `okra keys get <provider>`                      | Show if a key is set (masked) and its source; exit 1 if unset |
| `okra keys rm <provider>`                       | Remove a stored key                                           |

Confirmations go to **stderr**; `okra keys list` and `okra keys get` print to **stdout** so they're pipeable.
The key value is **never** echoed — `get` shows only a masked preview (`sk-pr…1234`).

## Usage

```bash
# Store the OpenAI key used by `okra image --model gpt-image-1.5`
okra keys set openai sk-...

# Pipe from a password manager so the key never lands in shell history
op read "op://Private/OpenAI/key" | okra keys set openai --stdin

# What's stored? (names only)
okra keys list
# → openai

# Is it configured, and from where? (masked — never reveals the secret)
okra keys get openai
# → sk-pr…1234 (stored)        # or "… (env OPENAI_API_KEY)" when the env var wins
# Exits 1 with [NOT_FOUND] if neither env nor stored — handy for scripts:
okra keys get openai >/dev/null 2>&1 || echo "set your OpenAI key first"

# Rotate / clear
okra keys rm openai
```

## Resolution precedence

When a domain needs a key, it checks the **environment variable first**, then the stored key:

1. `OPENAI_API_KEY` (or the domain's env var) — if set, it wins.
2. `~/.okra/keys.json[<provider>]` — the stored fallback.
3. Otherwise the domain fails with its own "missing key" error.

So an exported env var transparently overrides whatever is stored — handy for one-off runs or CI.

## Consumers

| Provider name | Used by                         | Env override     |
| ------------- | ------------------------------- | ---------------- |
| `openai`      | `okra image` (GPT-image/DALL·E) | `OPENAI_API_KEY` |

(Future domains reuse the same store under their own provider name.)

## Gotchas

- `set` **merges** into the existing map — storing one provider never clobbers another.
- `list` reads names only; it never decodes or prints secret values.
- The file is created `0600`; the parent `~/.okra/` directory is created on first write.
- A malformed `keys.json` is treated as empty (resolution falls through to env / missing-key error) rather than crashing.
- Removing a provider that isn't stored exits with `[NOT_FOUND]`.
