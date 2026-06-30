---
name: image
description: Generate images from text prompts. Two backends, chosen by --model — the ChatGPT codex backend (default, reuses codex login) or the metered OpenAI Images API (gpt-image-1.5 etc., needs an API key). Use when you need to create/render an image, illustration, logo, diagram, or photo from a description. Triggers on "okra image", "generate an image", "make a picture/logo/illustration", text-to-image, image generation.
---

# image

Generate images from a text prompt. The `--model` flag picks the backend:

- **codex** (default, `gpt-5.5`) — reuses your ChatGPT subscription via the `codex` CLI's OAuth token (`~/.codex/auth.json`). No metered billing. Streams through the ChatGPT "codex" Responses endpoint + the `image_generation` tool.
- **OpenAI Images API** (`gpt-image-1.5`, `gpt-image-1`, `gpt-image-1-mini`, `dall-e-3`, `dall-e-2`) — the metered REST endpoint `POST /images/generations`. Needs an OpenAI API key.

## Quick Reference

| Command                                                                               | What it does                                                      |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `okra image "<prompt>"`                                                               | Generate via codex (default). Save to `<slug>.png`. stdout = path |
| `okra image "<prompt>" --model gpt-image-1.5`                                         | Generate via the OpenAI Images API (needs a key)                  |
| `okra image "<prompt>" -o out.png`                                                    | Save to an explicit path                                          |
| `okra image "<prompt>" --size 1024x1024`                                              | Request a specific size (default `auto`)                          |
| `okra image "<prompt>" --format webp`                                                 | Output `png` (default), `webp`, or `jpeg`                         |
| `okra image "<prompt>" --model gpt-image-1.5 --quality high --background transparent` | OpenAI-only render controls                                       |
| `okra image "<prompt>" --model gpt-image-1.5 --n 3 -o out.png`                        | 3 images → `out-1.png`, `out-2.png`, `out-3.png`                  |
| `okra image "<prompt>" --ref style.png`                                               | Generate in the style of a reference image (codex only)           |
| `okra keys set openai <key>`                                                          | Store the OpenAI API key (see the **keys** skill)                 |

stdout = the saved file path(s), one per line. Progress/errors go to stderr — so `$(okra image ...)` captures just the path(s).

## Usage

```bash
# Default codex backend, slug-named file
okra image "a single ripe okra pod on a white background, minimalist"

# Metered OpenAI Images API with the latest model
okra image "neon okra logo on black" --model gpt-image-1.5 -o logo.png --size 1024x1024

# WebP for the web
okra image "a steaming bowl of okra gumbo, overhead shot" --format webp

# Compose with the shell
open "$(okra image 'a friendly robot mascot, flat vector')"
```

## Flags

| Flag           | Default                  | Notes                                                                    |
| -------------- | ------------------------ | ------------------------------------------------------------------------ |
| `-o`, `--out`  | `<slug>.<format>` in cwd | Output file path; parent dirs are created                                |
| `--size`       | `auto`                   | `auto` lets the model pick, or `WIDTHxHEIGHT`                            |
| `--format`     | `png`                    | One of `png`, `webp`, `jpeg`                                             |
| `--model`      | `gpt-5.5`                | Codex model, OR a `gpt-image-*` / `dall-e-*` id → OpenAI API             |
| `--quality`    | model default            | OpenAI models only: `auto`, `low`, `medium`, `high`                      |
| `--background` | model default            | OpenAI models only: `auto`, `transparent`, `opaque`                      |
| `--n`          | `1`                      | OpenAI models only: number of images to request                          |
| `--ref`        | none                     | **Codex only.** Path to a style/composition reference image (repeatable) |

`--quality` / `--background` / `--n` apply only to OpenAI image models; the codex backend prints a note and ignores them. With `--n > 1` the output files are suffixed `-1`, `-2`, … before the extension (e.g. `out.png` → `out-1.png`); a single image keeps the bare path.

### Style references (`--ref`)

`--ref <path>` attaches a reference image so the model generates a **new** image guided by the reference's style, palette, and composition — it does **not** edit the reference. Repeat `--ref` for several references. Supported types: `png`, `jpg`, `jpeg`, `webp`, `gif`.

```bash
# Generate a new logo in the style/palette of an existing one
okra image "a coffee cup logo in this flat geometric style" --ref brand-mark.png -o cup.png

# Multiple references
okra image "a hero illustration" --ref palette.png --ref layout.jpg -o hero.png
```

Only the **codex** backend supports references (via the Responses API's `input_image`). Passing `--ref` with an OpenAI image model (`gpt-image-*`/`dall-e-*`) fails with `INVALID_INPUT` — drop `--model` to use codex. (Pixel-level editing of the reference is a separate, future `--edit` mode.)

## Auth

### Codex backend (default)

1. Run `codex login` once — writes `~/.codex/auth.json`.
2. `okra image` reads the OAuth token (+ codex version from `~/.codex/version.json`) per invocation.

### OpenAI Images API (image models)

Provide an OpenAI API key. **Resolution precedence: `OPENAI_API_KEY` env var > stored key.**

```bash
# Store once (chmod 0600), or just export OPENAI_API_KEY
okra keys set openai sk-...
pbpaste | okra keys set openai --stdin
```

The stored key lives in `~/.okra/keys.json` — a generic, multi-provider map (`{ "openai": "sk-..." }`, `0600`) managed by the top-level `okra keys` command (see the **keys** skill). Use `okra keys list` / `okra keys rm openai` to inspect or clear it.

### Errors

- `[AUTH_MISSING]` — codex: no `~/.codex/auth.json` (run `codex login`). OpenAI: no key (set `OPENAI_API_KEY` or `okra keys set openai`).
- `[AUTH_EXPIRED]` — token/key rejected. Codex: re-run `codex login`. OpenAI: fix the key.
- `[GENERATION_FAILED]` / `[NO_IMAGE]` — backend error or empty result; try rephrasing.

## Gotchas

- The backend is inferred from `--model`: `gpt-image-*` and `dall-e-*` → OpenAI Images API; anything else → codex.
- Codex backend **requires** `store: false`, `stream: true`, and a current `version` header — all handled internally.
- During codex streaming, the backend emits an `image_generation_call` status of `"generating"` that the upstream `@effect/ai-openai` SSE schema does not model; okra rewrites it to `"in_progress"` at the byte level before decoding (`CodexStreamPatch`).
- The codex SSE response has **no** `content-type` header, so the patch is applied unconditionally on that codex-only client.
- The OpenAI Images API always returns base64 for GPT image models; okra decodes every returned image to raw bytes (one file per image with `--n`).
- The codex backend always produces exactly one image; `--n` is an OpenAI-only knob.
- `--size auto` may yield a non-square aspect ratio chosen by the model.
