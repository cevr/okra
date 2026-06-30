---
"@cvr/okra": minor
---

`okra image` gains `--edit` and `--mask` for pixel-level image editing (OpenAI GPT image models).

On a GPT image model (`gpt-image-1.5`, `gpt-image-1`, `gpt-image-1-mini`), `--ref <path>` is the **source image to edit** and routes to the OpenAI `/images/edits` endpoint, returning an edited version of the source. `--edit` is an explicit opt-in to the same behavior; `--mask <path>` supplies a PNG whose transparent areas mark where the edit applies. Multiple `--ref` are sent as up to 16 source images.

Routing is reconciled from the model + flags:

- **codex** (default) + `--ref` → style reference (unchanged); codex + `--edit`/`--mask` → `INVALID_INPUT` (codex has no pixel-edit primitive — use `--model gpt-image-1.5`).
- **OpenAI** + any input image → `/images/edits`. `--edit`/`--mask` without `--ref` → `INVALID_INPUT` (needs a source). `dall-e-*` + `--ref` → `INVALID_INPUT` (not edit-capable).

Editing requires an OpenAI API key (`OPENAI_API_KEY` or `okra keys set openai`), like the other OpenAI image paths.
