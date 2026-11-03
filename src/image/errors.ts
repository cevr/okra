import { Schema } from "effect";

export const ErrorCode = {
  AUTH_MISSING: "AUTH_MISSING",
  AUTH_EXPIRED: "AUTH_EXPIRED",
  GENERATION_FAILED: "GENERATION_FAILED",
  NO_IMAGE: "NO_IMAGE",
  DECODE_FAILED: "DECODE_FAILED",
  WRITE_FAILED: "WRITE_FAILED",
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

export class ImageError extends Schema.TaggedError<ImageError, { readonly brand: unique symbol }>()(
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
