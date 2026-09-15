/** Shared model, format, and authentication settings for both image backends. */

/** Base URL for the OpenAiClient. The provider appends `/responses`. */
export const CODEX_API_URL = "https://chatgpt.com/backend-api/codex";

/** Base URL for the metered OpenAI REST API (Images endpoint lives at `/images/generations`). */
export const OPENAI_API_URL = "https://api.openai.com/v1";

/** Env var holding the OpenAI API key for the metered (non-codex) backend. */
export const OPENAI_API_KEY_ENV = "OPENAI_API_KEY";

/** Name under which the OpenAI key is stored in the shared key store. */
export const OPENAI_KEY_NAME = "openai";

/** Default model — gpt-5.5 is known to accept the image_generation tool on the codex backend. */
export const DEFAULT_MODEL = "gpt-5.5";

/**
 * Models routed to the metered OpenAI Images API (`/images/generations`) instead
 * of the codex backend. Selecting any of these (via `--model`) requires
 * `OPENAI_API_KEY`. The list is a prefix set: `gpt-image-*` and `dall-e-*`.
 */
export const OPENAI_IMAGE_MODEL_PREFIXES = ["gpt-image", "dall-e"] as const;

/** GPT Image 2.5 models available through the image tool and the Images API. */
export const IMAGE_MODEL_CHOICES = ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"] as const;
export const DEFAULT_IMAGE_MODEL = IMAGE_MODEL_CHOICES[0];

/** GPT Image 2.5 aliases and dated snapshots support the additional quality levels. */
export const supportsExtendedQuality = (model: string): boolean =>
  /^gpt-image-2\.5-(?:flare|sunburst)(?:-\d{4}-\d{2}-\d{2})?$/.test(model);

/** True when `model` should be routed to the metered OpenAI Images API instead of codex. */
export const isOpenAiImageModel = (model: string): boolean =>
  OPENAI_IMAGE_MODEL_PREFIXES.some((prefix) => model.startsWith(prefix));

/** Default output image format. */
export const DEFAULT_FORMAT = "png";

/** Default image size; "auto" lets the model pick. */
export const DEFAULT_SIZE = "auto";

/** Quality values accepted by the OpenAI Images API (`--quality`). "auto" = model default. */
export const IMAGE_QUALITY_CHOICES = ["auto", "low", "medium", "high", "xhigh", "max"] as const;

/** Background values accepted by the OpenAI Images API (`--background`). */
export const IMAGE_BACKGROUND_CHOICES = ["auto", "transparent", "opaque"] as const;

/** Image MIME types the codex backend accepts as reference (`--ref`) input. */
const REF_MEDIA_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/** Map a reference file's extension to its MIME type, or `undefined` if unsupported. */
export const refMediaType = (filePath: string): string | undefined => {
  const dot = filePath.lastIndexOf(".");
  if (dot < 0) return undefined;
  return REF_MEDIA_TYPES[filePath.slice(dot).toLowerCase()];
};

/** True when the model is a GPT image model that supports the edits endpoint (not DALL·E 3+). */
export const supportsEdits = (model: string): boolean => model.startsWith("gpt-image");

/** `--input-fidelity` values accepted by the edits endpoint. "low" is the API default. */
export const IMAGE_FIDELITY_CHOICES = ["high", "low"] as const;

/**
 * True when the model supports `input_fidelity` on edits. Per the OpenAI schema it's
 * `gpt-image-1` / `gpt-image-1.5` only, including dated snapshots.
 */
export const supportsInputFidelity = (model: string): boolean =>
  /^gpt-image-1(?:\.5)?(?:-\d{4}-\d{2}-\d{2})?$/.test(model);

/** Identifier the codex backend expects; mirrors the codex CLI. */
export const ORIGINATOR = "codex_cli_rs";

/** Path (relative to home) of the codex OAuth credentials file. */
export const AUTH_RELATIVE_PATH = ".codex/auth.json";

/** Path (relative to home) of the codex CLI version file. */
export const VERSION_RELATIVE_PATH = ".codex/version.json";

/**
 * Floor for the `version` header. The codex backend rejects requests carrying a
 * too-old version with "requires a newer version of Codex", so we never send
 * below this even if version.json is missing or stale.
 */
export const FALLBACK_VERSION = "0.142.3";

/** System-style instruction known to be accepted on gpt-5.5 for image generation. */
export const IMAGE_INSTRUCTION = "You are an image generation assistant.";
