---
"@cvr/okra": minor
---

`okra image` gains `--fidelity` for high-fidelity edits.

When editing with a GPT image model, `--fidelity high` makes the model preserve the source image's detail and features — notably faces — instead of the default `low`. It maps to the OpenAI `/images/edits` `input_fidelity` field.

`--fidelity` is edits-only and model-gated:

- Requires the edit route (a `--ref` source); `--fidelity` on a plain generation → `INVALID_INPUT` ("only applies when editing").
- Supported on `gpt-image-1` / `gpt-image-1.5` only — `gpt-image-1-mini` → `INVALID_INPUT`.
- On the codex backend → `INVALID_INPUT` (use an OpenAI image model).

Omitting `--fidelity` leaves the API default (`low`) in place.
