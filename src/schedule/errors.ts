import { Schema } from "effect";

export class ScheduleError extends Schema.TaggedError<
  ScheduleError,
  { readonly brand: unique symbol }
>()("@cvr/okra/schedule/ScheduleError", {
  message: Schema.String,
  code: Schema.String,
}) {}
