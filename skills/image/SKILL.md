---
name: image
description: Generate images from text prompts with GPT Image 2.5 Flare or Sunburst. Use the ChatGPT subscription by default, or select the paid OpenAI Images API for generation and editing. Use for "okra image", image generation, illustrations, logos, diagrams, and photos.
---

# image

Generate images with GPT Image 2.5. The ChatGPT subscription remains the default.

- **Codex subscription:** `--model gpt-5.5` selects the main Responses model. Its image tool uses `gpt-image-2.5-flare` by default. Use `--image-model gpt-image-2.5-sunburst` to select Sunburst. Authentication comes from `codex login`.
- **OpenAI Images API:** `--model gpt-image-2.5-flare` or `--model gpt-image-2.5-sunburst` selects the paid API. This route needs an OpenAI API key. Use Flare for fast generation. Use Sunburst for precise edits.

`--image-model` selects the subscription tool. It cannot be combined with an API image model in `--model`.

## Quick reference

```bash
# ChatGPT subscription: Flare is the default image tool
okra image "a single ripe okra pod on white" -o okra.png

# ChatGPT subscription: select Sunburst
okra image "an illustrated botanical label" --image-model gpt-image-2.5-sunburst -o label.png

# Paid API: Flare with the new quality setting and a custom size
okra image "a landscape at dawn" --model gpt-image-2.5-flare \
  --quality xhigh --size 1536x864 -o landscape.png

# Paid API: Sunburst edit
okra image "change only the sky to sunset" --model gpt-image-2.5-sunburst \
  --ref photo.png --quality max -o sunset.png

# Paid API: mask guides the edit
okra image "replace the sky" --model gpt-image-2.5-sunburst \
  --ref photo.png --mask sky-mask.png -o edited.png

# Paid API: transparent output
okra image "a simple leaf icon" --model gpt-image-2.5-flare \
  --background transparent --format webp -o leaf.webp

# Paid API: multiple output files
okra image "an okra logo" --model gpt-image-2.5-flare --n 3 -o logo.png
```

The last command writes `logo-1.png`, `logo-2.png`, and `logo-3.png`.

## Flags

| Flag            | Default               | Use                                                                                               |
| --------------- | --------------------- | ------------------------------------------------------------------------------------------------- |
| `--out`, `-o`   | `<prompt-slug>.png`   | Output path.                                                                                      |
| `--model`       | `gpt-5.5`             | Main Codex model, or a direct API image model.                                                    |
| `--image-model` | `gpt-image-2.5-flare` | Codex image tool: Flare or Sunburst.                                                              |
| `--size`        | `auto`                | Image dimensions, such as `1024x1024` or `1536x864`.                                              |
| `--format`      | `png`                 | `png`, `webp`, or `jpeg`.                                                                         |
| `--quality`     | API model default     | API only: `auto`, `low`, `medium`, `high`, `xhigh`, or `max`. The last two require GPT Image 2.5. |
| `--background`  | API model default     | API only: `auto`, `transparent`, or `opaque`. Use PNG or WebP for transparency.                   |
| `--n`           | `1`                   | API only: number of output images.                                                                |
| `--ref`         | none                  | Repeatable input path. Codex: reference image. API: source image to edit.                         |
| `--edit`        | off                   | Explicit API edit request. Requires `--ref`.                                                      |
| `--mask`        | none                  | API edit mask. Requires `--ref`.                                                                  |
| `--fidelity`    | omitted               | Legacy `gpt-image-1` and `gpt-image-1.5` edits only: `high` or `low`. Omit for GPT Image 2.5.     |

`--quality`, `--background`, and `--n` apply only to the API route. The subscription route prints a note and ignores these flags. It returns one image.

stdout contains the saved path, or one path per line for multiple images. Progress and errors go to stderr.

## References and edits

On the subscription route, `--ref` supplies an image reference to the Responses model. This command supports explicit `--edit` and `--mask` controls only on the API route.

On the API route, `--ref` selects `/images/edits`. Use up to 16 source images. A mask applies to the first source image. Transparent areas guide the edit. A mask does not guarantee exact pixel boundaries.

Use PNG, JPEG, or WebP sources. Use a PNG mask with an alpha channel. The CLI can also read GIF references, but acceptance depends on the selected backend. Output files are separate from source files unless you select the source path with `-o`.

GPT Image 2.5 accepts custom dimensions. Each edge must be a multiple of 16 and at most 3840 pixels. The aspect ratio must stay between 1:3 and 3:1. The total must be from 655,360 to 8,294,400 pixels. The API checks these limits. Sizes above 2560x1440 are experimental.

Legacy model names still route to the API. Their availability and controls depend on OpenAI. Do not use `xhigh` or `max` with a legacy model.

## Authentication

For the subscription route, run `codex login`. Okra reads `~/.codex/auth.json` and the Codex version on each request.

For the paid API, use `OPENAI_API_KEY` or store a key:

```bash
pbpaste | okra keys set openai --stdin
```

The environment value takes priority over the stored key. Stored keys use `~/.okra/keys.json` with mode `0600`. Use `okra keys get openai` to see the source and a masked value.

## Errors

- `AUTH_MISSING`: run `codex login`, or set the API key for the selected route.
- `AUTH_EXPIRED`: the server rejected the credentials. Sign in again or replace the API key.
- `INVALID_INPUT`: check the model and flags. API edit controls need a source image. `--image-model` requires the subscription route.
- `GENERATION_FAILED`: the server rejected the request or returned an invalid response.
- `NO_IMAGE`: the response contains no image.
- `DECODE_FAILED`: the response contains invalid base64 data.

## Transport notes

The subscription route sends `store: false`, streams the response, and includes the installed Codex version. `CodexStreamPatch` handles the server's `generating` image status before the Effect adapter decodes the stream.

The API route decodes all base64 image results. Okra extends the upstream request and response schemas for GPT Image 2.5 quality values and custom response sizes.

## Sources

- [OpenAI image generation guide](https://developers.openai.com/api/docs/guides/image-generation)
- [GPT Image 2.5 Flare](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare)
- [GPT Image 2.5 Sunburst](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst)
