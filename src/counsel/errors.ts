import { Schema } from "effect";

export const ErrorCode = {
  CLI_USAGE_ERROR: "CLI_USAGE_ERROR",
  AMBIGUOUS_PROVIDER: "AMBIGUOUS_PROVIDER",
  FILE_READ_FAILED: "FILE_READ_FAILED",
  PROMPT_CONFLICT: "PROMPT_CONFLICT",
  PROMPT_MISSING: "PROMPT_MISSING",
  READ_FAILED: "READ_FAILED",
  SPAWN_FAILED: "SPAWN_FAILED",
  TARGET_NOT_INSTALLED: "TARGET_NOT_INSTALLED",
  WRITE_FAILED: "WRITE_FAILED",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const ErrorCodeSchema = Schema.Literals([
  "CLI_USAGE_ERROR",
  "AMBIGUOUS_PROVIDER",
  "FILE_READ_FAILED",
  "PROMPT_CONFLICT",
  "PROMPT_MISSING",
  "READ_FAILED",
  "SPAWN_FAILED",
  "TARGET_NOT_INSTALLED",
  "WRITE_FAILED",
]);

export class CounselError extends Schema.TaggedErrorClass<CounselError>()(
  "@cvr/okra/counsel/CounselError",
  {
    message: Schema.String,
    code: ErrorCodeSchema,
    command: Schema.optional(Schema.String),
  },
) {}
export const isCounselError = Schema.is(CounselError);

export const ErrorPayload = Schema.Struct({
  error: Schema.String,
  code: ErrorCodeSchema,
  message: Schema.String,
});
export type ErrorPayload = typeof ErrorPayload.Type;

export const ErrorPayloadJson = Schema.fromJsonString(ErrorPayload);
export const encodeErrorPayload = Schema.encodeEffect(ErrorPayloadJson);
