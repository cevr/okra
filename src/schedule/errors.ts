import { Schema } from "effect";

export class ScheduleError extends Schema.TaggedErrorClass<ScheduleError>()(
  "@cvr/okra/schedule/ScheduleError",
  {
    message: Schema.String,
    code: Schema.String,
  },
) {}
