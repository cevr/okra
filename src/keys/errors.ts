import { Schema } from "effect";

export const ErrorCodeSchema = Schema.Literals([
  /** No key found for the requested provider. */
  "NOT_FOUND",
  /** Could not read, parse, or write the key store. */
  "STORE_FAILED",
  /** Invalid CLI input (empty key, missing argument, etc.). */
  "INVALID_INPUT",
]);

export type ErrorCode = typeof ErrorCodeSchema.Type;

export class KeysError extends Schema.TaggedErrorClass<KeysError>()("@cvr/okra/keys/KeysError", {
  message: Schema.String,
  code: ErrorCodeSchema,
}) {}

export const isKeysError = (e: unknown): e is { _tag: string; code: string; message: string } => {
  if (typeof e !== "object" || e === null || !("_tag" in e)) return false;
  return (e as { _tag: unknown })._tag === "@cvr/okra/keys/KeysError";
};
