/**
 * Constants for the codex image-generation backend.
 *
 * The `okra image` command reuses the ChatGPT subscription via the same internal
 * "codex" Responses endpoint the `codex` CLI authenticates against. It does NOT
 * use the metered OpenAI Images API. Auth comes from the OAuth token that
 * `codex login` writes to `~/.codex/auth.json`.
 *
 * Reference: leeguooooo/chatgpt-imagegen (codex backend) + the gent project's
 * codex-transform middleware.
 */

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

/** The recommended latest image model for the metered API. */
export const DEFAULT_OPENAI_IMAGE_MODEL = "gpt-image-1.5";

/** True when `model` should be routed to the metered OpenAI Images API instead of codex. */
export const isOpenAiImageModel = (model: string): boolean =>
  OPENAI_IMAGE_MODEL_PREFIXES.some((prefix) => model.startsWith(prefix));

/** Default output image format. */
export const DEFAULT_FORMAT = "png";

/** Default image size; "auto" lets the model pick. */
export const DEFAULT_SIZE = "auto";

/** Quality values accepted by the OpenAI Images API (`--quality`). "auto" = model default. */
export const IMAGE_QUALITY_CHOICES = ["auto", "low", "medium", "high"] as const;

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

/** Default model for the OpenAI `/images/edits` path (only GPT image models support edits). */
export const DEFAULT_OPENAI_EDIT_MODEL = DEFAULT_OPENAI_IMAGE_MODEL;

/** True when the model is a GPT image model that supports the edits endpoint (not DALL·E 3+). */
export const supportsEdits = (model: string): boolean => model.startsWith("gpt-image");

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
