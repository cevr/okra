import { Schema } from "effect";

export const ErrorCodeSchema = Schema.Literals([
  /** No embedded guide for the requested topic. */
  "NOT_FOUND",
]);

export type ErrorCode = typeof ErrorCodeSchema.Type;

export class HowError extends Schema.TaggedErrorClass<HowError>()("@cvr/okra/how/HowError", {
  message: Schema.String,
  code: ErrorCodeSchema,
}) {}

export const isHowError = (e: unknown): e is { _tag: string; code: string; message: string } => {
  if (typeof e !== "object" || e === null || !("_tag" in e)) return false;
  return (e as { _tag: unknown })._tag === "@cvr/okra/how/HowError";
};
