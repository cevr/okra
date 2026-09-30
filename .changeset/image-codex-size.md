---
"@cvr/okra": patch
---

`okra image` on the Codex route now asks for the `--size` in the prompt, because the Codex backend ignores the image tool's size setting. Portrait and landscape sizes now come back exact. When the result still differs (a square comes back as 1254x1254), okra prints a note on stderr and points to an OpenAI image model for an exact size.
