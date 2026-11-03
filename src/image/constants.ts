export const CODEX_API_URL = "https://chatgpt.com/backend-api/codex";

export const OPENAI_API_URL = "https://api.openai.com/v1";

export const OPENAI_API_KEY_ENV = "OPENAI_API_KEY";

export const OPENAI_KEY_NAME = "openai";

export const OPENAI_IMAGE_MODEL_PREFIXES = ["gpt-image", "dall-e"] as const;

export const DEFAULT_IMAGE_MODEL = "gpt-image-2.5-flare";

export const supportsExtendedQuality = (model: string): boolean =>
  /^gpt-image-2\.5-(?:flare|sunburst)(?:-\d{4}-\d{2}-\d{2})?$/.test(model);

export const isOpenAiImageModel = (model: string): boolean =>
  OPENAI_IMAGE_MODEL_PREFIXES.some((prefix) => model.startsWith(prefix));

export const DEFAULT_FORMAT = "png";

export const DEFAULT_SIZE = "auto";

export const IMAGE_QUALITY_CHOICES = ["auto", "low", "medium", "high", "xhigh", "max"] as const;

export const IMAGE_BACKGROUND_CHOICES = ["auto", "transparent", "opaque"] as const;

const REF_MEDIA_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export const refMediaType = (filePath: string): string | undefined => {
  const dot = filePath.lastIndexOf(".");
  if (dot < 0) return undefined;
  return REF_MEDIA_TYPES[filePath.slice(dot).toLowerCase()];
};

export const supportsEdits = (model: string): boolean => model.startsWith("gpt-image");

export const IMAGE_FIDELITY_CHOICES = ["high", "low"] as const;

export const supportsInputFidelity = (model: string): boolean =>
  /^gpt-image-1(?:\.5)?(?:-\d{4}-\d{2}-\d{2})?$/.test(model);

export const ORIGINATOR = "codex_cli_rs";

export const AUTH_RELATIVE_PATH = ".codex/auth.json";

export const VERSION_RELATIVE_PATH = ".codex/version.json";

export const FALLBACK_VERSION = "0.142.3";

export const IMAGE_INSTRUCTION = "You are an image generation assistant.";
