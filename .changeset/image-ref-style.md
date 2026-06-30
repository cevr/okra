---
"@cvr/okra": minor
---

`okra image` gains `--ref <path>` for style/composition references.

Pass `--ref` (repeatable) to condition generation on one or more reference images — the model produces a **new** image guided by the reference's style, palette, and composition, without editing the reference itself. References are attached as input images to the codex backend via the Responses API's `input_image` content. Supported types: png, jpg, jpeg, webp, gif.

On the **codex** backend `--ref` is a style reference (a new image is generated). On an **OpenAI image model** (`gpt-image-*`) `--ref` is the source image to edit and routes to `/images/edits` (see the `--edit`/`--mask` changeset).
