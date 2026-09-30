---
"@cvr/okra": minor
---

Counsel and `okra image` now use the newest GPT Sol model that the Codex account can use, instead of a pinned model, so a new Sol release needs no okra release. models.dev gives the release order (cached in `~/.okra/models.json` for a day), and the Codex CLI's model list filters it. When Codex rejects a model for a ChatGPT account, the command retries with the next older candidate, down to `gpt-6-sol`. The image default changes from `gpt-5.5` to the newest usable GPT Sol.
