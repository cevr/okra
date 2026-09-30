---
"@cvr/okra": minor
---

Remove the `--image-model` flag from `okra image`. The Codex backend always replaces the image tool's model with its own (`gpt-image-2-codex`), so the flag had no effect there, and the paid API route already rejected it. To use Flare or Sunburst, pass `--model gpt-image-2.5-flare` or `--model gpt-image-2.5-sunburst`, which uses the OpenAI Images API.
