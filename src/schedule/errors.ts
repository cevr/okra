import { Schema } from "effect";

export class ScheduleError extends Schema.TaggedError<ScheduleError>()(
  "@cvr/okra/schedule/ScheduleError",
  {
    message: Schema.String,
    code: Schema.String,
  },
) {}
