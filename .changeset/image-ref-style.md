---
"@cvr/okra": minor
---

`okra image` gains `--ref <path>` for style/composition references.

Pass `--ref` (repeatable) to condition generation on one or more reference images — the model produces a **new** image guided by the reference's style, palette, and composition, without editing the reference itself. References are attached as input images to the codex backend via the Responses API's `input_image` content. Supported types: png, jpg, jpeg, webp, gif.

`--ref` is **codex-only**: the OpenAI Images `/generations` endpoint has no input-image parameter, so `--ref` with a `gpt-image-*` / `dall-e-*` model fails with a clear `INVALID_INPUT` error pointing you to the codex backend. (Pixel-level editing of the reference is a separate, future `--edit` mode.)
