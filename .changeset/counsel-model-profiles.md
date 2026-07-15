---
"@cvr/okra": minor
---

Update `okra counsel` to select explicit models for standard and deep runs.

- Claude standard runs use Opus 4.8 at medium effort; `--deep` uses Fable at max effort.
- Codex runs use GPT-5.6 SOL at medium effort; `--deep` raises reasoning effort to xhigh.
