import { Schema } from "effect";

export const ErrorCode = {
  /** ~/.codex/auth.json missing or unreadable — user has not run `codex login`. */
  AUTH_MISSING: "AUTH_MISSING",
  /** Token present but rejected by the backend (401/403) — user must refresh. */
  AUTH_EXPIRED: "AUTH_EXPIRED",
  /** Backend returned an error or an unexpected response shape. */
  GENERATION_FAILED: "GENERATION_FAILED",
  /** Backend completed but produced no image data. */
  NO_IMAGE: "NO_IMAGE",
  /** Could not decode the returned base64 image payload. */
  DECODE_FAILED: "DECODE_FAILED",
  /** Could not write the image to the requested output path. */
  WRITE_FAILED: "WRITE_FAILED",
  /** Invalid CLI input (bad size, conflicting flags, etc.). */
  INVALID_INPUT: "INVALID_INPUT",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const ErrorCodeSchema = Schema.Literals([
  "AUTH_MISSING",
  "AUTH_EXPIRED",
  "GENERATION_FAILED",
  "NO_IMAGE",
  "DECODE_FAILED",
  "WRITE_FAILED",
  "INVALID_INPUT",
]);

export class ImageError extends Schema.TaggedErrorClass<ImageError>()(
  "@cvr/okra/image/ImageError",
  {
    message: Schema.String,
    code: ErrorCodeSchema,
  },
) {}

export const isImageError = (e: unknown): e is { _tag: string; code: string; message: string } => {
  if (typeof e !== "object" || e === null || !("_tag" in e)) return false;
  return (e as { _tag: unknown })._tag === "@cvr/okra/image/ImageError";
};
