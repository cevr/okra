import { Schema } from "effect";

export const ErrorCodeSchema = Schema.Literals(["NOT_FOUND", "STORE_FAILED", "INVALID_INPUT"]);

export type ErrorCode = typeof ErrorCodeSchema.Type;

export class KeysError extends Schema.TaggedError<KeysError, { readonly brand: unique symbol }>()(
  "@cvr/okra/keys/KeysError",
  {
    message: Schema.String,
    code: ErrorCodeSchema,
  },
) {}

export const isKeysError = (e: unknown): e is { _tag: string; code: string; message: string } => {
  if (typeof e !== "object" || e === null || !("_tag" in e)) return false;
  return (e as { _tag: unknown })._tag === "@cvr/okra/keys/KeysError";
};
