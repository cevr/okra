import { DateTime, Effect, Option, Schema } from "effect";
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

const parseDowField = (field: string): Option.Option<number | string> => {
  if (field === "*") return Option.some("*");
  if (/^\d+$/.test(field)) {
    const n = parseInt(field, 10);
    if (n < 0 || n > 6) return Option.none();
    return Option.some(n);
  }
  const rangeMatch = field.match(DOW_RANGE);
  if (rangeMatch !== null && rangeMatch[1] !== undefined && rangeMatch[2] !== undefined) {
    const start = parseInt(rangeMatch[1], 10);
    const end = parseInt(rangeMatch[2], 10);
    if (start >= 0 && start <= 6 && end >= 0 && end <= 6 && start < end) {
      return Option.some(field);
    }
  }
  return Option.none();
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const parseIn = (trimmed: string, nowMs: number): Option.Option<Schedule> => {
  const m = trimmed.match(IN_PATTERN);
  if (m === null || m[1] === undefined || m[2] === undefined) return Option.none();
  const amount = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  let atMs = nowMs;
  if (unit.startsWith("minute")) atMs += amount * MINUTE_MS;
  else if (unit.startsWith("hour")) atMs += amount * HOUR_MS;
  else atMs += amount * DAY_MS;
  return Option.some({
    _tag: "Oneshot" as const,
    at: DateTime.formatIso(DateTime.makeUnsafe(atMs)),
    raw: trimmed,
  });
};

const parseEveryDay = (trimmed: string): Option.Option<Schedule> => {
  const m = trimmed.match(EVERY_DAY_AT_PATTERN);
  if (m === null || m[1] === undefined) return Option.none();
  const { hour, minute } = parseTime(m[1], m[2], m[3]);
  return Option.some({
    _tag: "Cron" as const,
    minute,
    hour,
    dayOfMonth: "*" as const,
    month: "*" as const,
    dayOfWeek: "*" as const,
    raw: trimmed,
  });
};

const parseEveryWeekday = (trimmed: string): Option.Option<Schedule> => {
  const m = trimmed.match(EVERY_WEEKDAY_AT_PATTERN);
  if (m === null || m[1] === undefined) return Option.none();
  const { hour, minute } = parseTime(m[1], m[2], m[3]);
  return Option.some({
    _tag: "Cron" as const,
    minute,
    hour,
    dayOfMonth: "*" as const,
    month: "*" as const,
    dayOfWeek: "1-5",
    raw: trimmed,
  });
};

const parseEveryNamedDay = (trimmed: string): Option.Option<Schedule> => {
  const m = trimmed.match(EVERY_NAMED_DAY_PATTERN);
  if (m === null || m[1] === undefined || m[2] === undefined) return Option.none();
  const dow = DAY_NAMES[m[1].toLowerCase()];
  if (dow === undefined) return Option.none();
  const { hour, minute } = parseTime(m[2], m[3], m[4]);
  return Option.some({
    _tag: "Cron" as const,
    minute,
    hour,
    dayOfMonth: "*" as const,
    month: "*" as const,
    dayOfWeek: dow,
    raw: trimmed,
  });
};

const parseTomorrow = (trimmed: string, nowMs: number): Option.Option<Schedule> => {
  const m = trimmed.match(TOMORROW_AT_PATTERN);
  if (m === null || m[1] === undefined) return Option.none();
  const { hour, minute } = parseTime(m[1], m[2], m[3]);
  const tomorrowMs = nowMs + DAY_MS;
  const parts = DateTime.toParts(DateTime.makeUnsafe(tomorrowMs));
  // Reconstruct as UTC at the requested hour. Original used Date.setHours (local) —
  // we switch to UTC for determinism across env timezones.
  const atIso = DateTime.formatIso(
    DateTime.makeUnsafe({
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour,
      minute,
      second: 0,
      millisecond: 0,
    }),
  );
  return Option.some({ _tag: "Oneshot" as const, at: atIso, raw: trimmed });
};

const parseCron = (trimmed: string): Option.Option<Schedule> => {
  const m = trimmed.match(CRON_PATTERN);
  if (
    m === null ||
    m[1] === undefined ||
    m[2] === undefined ||
    m[3] === undefined ||
    m[4] === undefined ||
    m[5] === undefined
  ) {
    return Option.none();
  }
  const dow = parseDowField(m[5]);
  if (Option.isNone(dow)) return Option.none();
  return Option.some({
    _tag: "Cron" as const,
    minute: parseNumericField(m[1]),
    hour: parseNumericField(m[2]),
    dayOfMonth: parseNumericField(m[3]),
    month: parseNumericField(m[4]),
    dayOfWeek: dow.value,
    raw: trimmed,
  });
};

const parseSync = (input: string, nowMs: number): Option.Option<Schedule> => {
  const trimmed = input.trim();
  const inOpt = parseIn(trimmed, nowMs);
  if (Option.isSome(inOpt)) return inOpt;
  const everyDayOpt = parseEveryDay(trimmed);
  if (Option.isSome(everyDayOpt)) return everyDayOpt;
  const weekdayOpt = parseEveryWeekday(trimmed);
  if (Option.isSome(weekdayOpt)) return weekdayOpt;
  const namedDayOpt = parseEveryNamedDay(trimmed);
  if (Option.isSome(namedDayOpt)) return namedDayOpt;
  const tomorrowOpt = parseTomorrow(trimmed, nowMs);
  if (Option.isSome(tomorrowOpt)) return tomorrowOpt;
  return parseCron(trimmed);
};

export const parse = Effect.fn("Schedule.parse")(function* (input: string, nowMs: number) {
  const result = parseSync(input, nowMs);
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
    const dt = DateTime.makeUnsafe(schedule.at);
    return `once at ${DateTime.formatIso(dt)}`;
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
    const parts = DateTime.toParts(DateTime.makeUnsafe(schedule.at));
    return [{ Month: parts.month, Day: parts.day, Hour: parts.hour, Minute: parts.minute }];
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
