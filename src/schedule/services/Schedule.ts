import { Effect, Option, Schema } from "effect";
import { ScheduleError } from "../errors.js";

const NumOrStar = Schema.Union([Schema.Number, Schema.Literal("*")]);

export const ScheduleSchema = Schema.TaggedUnion({
  Cron: {
    minute: NumOrStar,
    hour: NumOrStar,
    dayOfMonth: NumOrStar,
    month: NumOrStar,
    dayOfWeek: Schema.Union([Schema.Number, Schema.String]),
    raw: Schema.String,
  },
  Oneshot: {
    at: Schema.String,
    raw: Schema.String,
  },
});

export type Schedule = typeof ScheduleSchema.Type;
export type CronSchedule = Extract<Schedule, { readonly _tag: "Cron" }>;
export type OneshotSchedule = Extract<Schedule, { readonly _tag: "Oneshot" }>;

const DAY_NAMES: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

const IN_PATTERN = /^in\s+(\d+)\s+(minutes?|hours?|days?)$/i;
const EVERY_DAY_AT_PATTERN = /^every\s+day\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i;
const EVERY_WEEKDAY_AT_PATTERN = /^every\s+weekday\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i;
const EVERY_NAMED_DAY_PATTERN =
  /^every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i;
const TOMORROW_AT_PATTERN = /^tomorrow\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i;
const CRON_PATTERN = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$/;

const parseTime = (
  hourStr: string,
  minuteStr: string | undefined,
  ampm: string | undefined,
): { hour: number; minute: number } => {
  let hour = parseInt(hourStr, 10);
  const minute = minuteStr !== undefined ? parseInt(minuteStr, 10) : 0;
  if (ampm !== undefined) {
    const lower = ampm.toLowerCase();
    if (lower === "pm" && hour !== 12) hour += 12;
    if (lower === "am" && hour === 12) hour = 0;
  }
  return { hour, minute };
};

const parseNumericField = (field: string): number | "*" => {
  if (field === "*") return "*";
  return parseInt(field, 10);
};

const DOW_RANGE = /^(\d)-(\d)$/;

const parseDowField = (field: string): Option.Option<number | "*" | string> => {
  if (field === "*") return Option.some("*");
  if (/^\d+$/.test(field)) {
    const n = parseInt(field, 10);
    if (n < 0 || n > 6) return Option.none();
    return Option.some(n);
  }
  const rangeMatch = field.match(DOW_RANGE);
  if (rangeMatch !== null) {
    const start = parseInt(rangeMatch[1] as string, 10);
    const end = parseInt(rangeMatch[2] as string, 10);
    if (start >= 0 && start <= 6 && end >= 0 && end <= 6 && start < end) {
      return Option.some(field);
    }
  }
  return Option.none();
};

export const parse = Effect.fn("Schedule.parse")(function* (input: string, now: Date = new Date()) {
  const trimmed = input.trim();

  const result = yield* Effect.sync((): Option.Option<Schedule> => {
    const inMatch = trimmed.match(IN_PATTERN);
    if (inMatch !== null) {
      const amount = parseInt(inMatch[1] as string, 10);
      const unit = (inMatch[2] as string).toLowerCase();
      const at = new Date(now.getTime());
      if (unit.startsWith("minute")) at.setMinutes(at.getMinutes() + amount);
      else if (unit.startsWith("hour")) at.setHours(at.getHours() + amount);
      else at.setDate(at.getDate() + amount);
      return Option.some({ _tag: "Oneshot" as const, at: at.toISOString(), raw: trimmed });
    }

    const everyDayMatch = trimmed.match(EVERY_DAY_AT_PATTERN);
    if (everyDayMatch !== null) {
      const { hour, minute } = parseTime(
        everyDayMatch[1] as string,
        everyDayMatch[2],
        everyDayMatch[3],
      );
      return Option.some({
        _tag: "Cron" as const,
        minute,
        hour,
        dayOfMonth: "*" as const,
        month: "*" as const,
        dayOfWeek: "*" as const,
        raw: trimmed,
      });
    }

    const weekdayMatch = trimmed.match(EVERY_WEEKDAY_AT_PATTERN);
    if (weekdayMatch !== null) {
      const { hour, minute } = parseTime(
        weekdayMatch[1] as string,
        weekdayMatch[2],
        weekdayMatch[3],
      );
      return Option.some({
        _tag: "Cron" as const,
        minute,
        hour,
        dayOfMonth: "*" as const,
        month: "*" as const,
        dayOfWeek: "1-5",
        raw: trimmed,
      });
    }

    const namedDayMatch = trimmed.match(EVERY_NAMED_DAY_PATTERN);
    if (namedDayMatch !== null) {
      const dow = DAY_NAMES[(namedDayMatch[1] as string).toLowerCase()];
      const { hour, minute } = parseTime(
        namedDayMatch[2] as string,
        namedDayMatch[3],
        namedDayMatch[4],
      );
      if (dow !== undefined) {
        return Option.some({
          _tag: "Cron" as const,
          minute,
          hour,
          dayOfMonth: "*" as const,
          month: "*" as const,
          dayOfWeek: dow,
          raw: trimmed,
        });
      }
    }

    const tomorrowMatch = trimmed.match(TOMORROW_AT_PATTERN);
    if (tomorrowMatch !== null) {
      const { hour, minute } = parseTime(
        tomorrowMatch[1] as string,
        tomorrowMatch[2],
        tomorrowMatch[3],
      );
      const at = new Date(now.getTime());
      at.setDate(at.getDate() + 1);
      at.setHours(hour, minute, 0, 0);
      return Option.some({ _tag: "Oneshot" as const, at: at.toISOString(), raw: trimmed });
    }

    const cronMatch = trimmed.match(CRON_PATTERN);
    if (cronMatch !== null) {
      const dow = parseDowField(cronMatch[5] as string);
      if (Option.isNone(dow)) return Option.none();
      return Option.some({
        _tag: "Cron" as const,
        minute: parseNumericField(cronMatch[1] as string),
        hour: parseNumericField(cronMatch[2] as string),
        dayOfMonth: parseNumericField(cronMatch[3] as string),
        month: parseNumericField(cronMatch[4] as string),
        dayOfWeek: dow.value,
        raw: trimmed,
      });
    }

    return Option.none();
  });

  return yield* Effect.fromOption(result).pipe(
    Effect.mapError(
      () =>
        new ScheduleError({
          message: `Cannot parse schedule: "${input}"`,
          code: "INVALID_SCHEDULE",
        }),
    ),
  );
});

export const describe = (schedule: Schedule): string => {
  if (schedule._tag === "Oneshot") {
    return `once at ${new Date(schedule.at).toLocaleString()}`;
  }
  const { minute, hour, dayOfWeek } = schedule;
  const timeStr =
    hour === "*"
      ? "every hour"
      : `${String(hour).padStart(2, "0")}:${String(minute === "*" ? 0 : minute).padStart(2, "0")}`;
  if (dayOfWeek === "1-5") return `weekdays at ${timeStr}`;
  if (dayOfWeek === "*") return `daily at ${timeStr}`;
  if (typeof dayOfWeek === "number") {
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return `every ${names[dayOfWeek]} at ${timeStr}`;
  }
  return `cron: ${schedule.raw}`;
};

export const toCalendarIntervals = (schedule: Schedule): ReadonlyArray<Record<string, number>> => {
  if (schedule._tag === "Oneshot") {
    const d = new Date(schedule.at);
    return [
      { Month: d.getMonth() + 1, Day: d.getDate(), Hour: d.getHours(), Minute: d.getMinutes() },
    ];
  }

  const { minute, hour, dayOfMonth, month, dayOfWeek } = schedule;

  if (typeof dayOfWeek === "string" && dayOfWeek.includes("-")) {
    const [start = 0, end = 0] = dayOfWeek.split("-").map(Number);
    const intervals: Array<Record<string, number>> = [];
    for (let d = start; d <= end; d++) {
      const entry: Record<string, number> = { Weekday: d };
      if (minute !== "*") entry["Minute"] = minute;
      if (hour !== "*") entry["Hour"] = hour as number;
      if (dayOfMonth !== "*") entry["Day"] = dayOfMonth;
      if (month !== "*") entry["Month"] = month;
      intervals.push(entry);
    }
    return intervals;
  }

  const entry: Record<string, number> = {};
  if (typeof dayOfWeek === "number") entry["Weekday"] = dayOfWeek;
  if (minute !== "*") entry["Minute"] = minute;
  if (hour !== "*") entry["Hour"] = hour as number;
  if (dayOfMonth !== "*") entry["Day"] = dayOfMonth;
  if (month !== "*") entry["Month"] = month;

  return [entry];
};
