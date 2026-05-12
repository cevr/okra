import { describe, expect, it, test } from "effect-bun-test";
import { Effect, Exit } from "effect";
import * as Schedule from "../../../src/schedule/services/Schedule.js";

// 2026-03-15T12:00:00.000Z in milliseconds since epoch
const FIXED_NOW_MS = 1773576000000;

describe("Schedule.parse", () => {
  it.effect("oneshot: in N minutes", () =>
    Effect.gen(function* () {
      const schedule = yield* Schedule.parse("in 30 minutes", FIXED_NOW_MS);
      expect(schedule._tag).toBe("Oneshot");
    }),
  );

  it.effect("oneshot: in N hours", () =>
    Effect.gen(function* () {
      const schedule = yield* Schedule.parse("in 2 hours", FIXED_NOW_MS);
      expect(schedule._tag).toBe("Oneshot");
    }),
  );

  it.effect("oneshot: tomorrow at", () =>
    Effect.gen(function* () {
      const schedule = yield* Schedule.parse("tomorrow at 9am", FIXED_NOW_MS);
      expect(schedule._tag).toBe("Oneshot");
    }),
  );

  it.effect("cron: every day at", () =>
    Effect.gen(function* () {
      const schedule = yield* Schedule.parse("every day at 9am", FIXED_NOW_MS);
      expect(schedule._tag).toBe("Cron");
      if (schedule._tag === "Cron") {
        expect(schedule.hour).toBe(9);
        expect(schedule.minute).toBe(0);
        expect(schedule.dayOfWeek).toBe("*");
      }
    }),
  );

  it.effect("cron: every weekday at", () =>
    Effect.gen(function* () {
      const schedule = yield* Schedule.parse("every weekday at 9am", FIXED_NOW_MS);
      expect(schedule._tag).toBe("Cron");
      if (schedule._tag === "Cron") {
        expect(schedule.hour).toBe(9);
        expect(schedule.dayOfWeek).toBe("1-5");
      }
    }),
  );

  it.effect("cron: every monday at", () =>
    Effect.gen(function* () {
      const schedule = yield* Schedule.parse("every monday at 10:30am", FIXED_NOW_MS);
      expect(schedule._tag).toBe("Cron");
      if (schedule._tag === "Cron") {
        expect(schedule.hour).toBe(10);
        expect(schedule.minute).toBe(30);
        expect(schedule.dayOfWeek).toBe(1);
      }
    }),
  );

  it.effect("cron: 5-field", () =>
    Effect.gen(function* () {
      const schedule = yield* Schedule.parse("0 9 * * 1-5", FIXED_NOW_MS);
      expect(schedule._tag).toBe("Cron");
      if (schedule._tag === "Cron") {
        expect(schedule.minute).toBe(0);
        expect(schedule.hour).toBe(9);
      }
    }),
  );

  it.effect("rejects invalid input", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(Schedule.parse("not a schedule", FIXED_NOW_MS));
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );
});

describe("Schedule.describe", () => {
  test("daily cron", () => {
    const desc = Schedule.describe({
      _tag: "Cron",
      minute: 0,
      hour: 9,
      dayOfMonth: "*",
      month: "*",
      dayOfWeek: "*",
      raw: "",
    });
    expect(desc).toBe("daily at 09:00");
  });

  test("weekday cron", () => {
    const desc = Schedule.describe({
      _tag: "Cron",
      minute: 0,
      hour: 9,
      dayOfMonth: "*",
      month: "*",
      dayOfWeek: "1-5",
      raw: "",
    });
    expect(desc).toBe("weekdays at 09:00");
  });

  test("named day cron", () => {
    const desc = Schedule.describe({
      _tag: "Cron",
      minute: 0,
      hour: 9,
      dayOfMonth: "*",
      month: "*",
      dayOfWeek: 1,
      raw: "",
    });
    expect(desc).toContain("Mon");
  });
});

describe("Schedule.toCalendarIntervals", () => {
  test("oneshot produces single interval", () => {
    const intervals = Schedule.toCalendarIntervals({
      _tag: "Oneshot",
      at: "2026-03-15T09:00:00.000Z",
      raw: "",
    });
    expect(intervals).toHaveLength(1);
    expect(intervals[0]).toHaveProperty("Hour");
    expect(intervals[0]).toHaveProperty("Minute");
  });

  test("weekday range produces 5 intervals", () => {
    const intervals = Schedule.toCalendarIntervals({
      _tag: "Cron",
      minute: 0,
      hour: 9,
      dayOfMonth: "*",
      month: "*",
      dayOfWeek: "1-5",
      raw: "",
    });
    expect(intervals).toHaveLength(5);
  });

  test("daily produces 1 interval", () => {
    const intervals = Schedule.toCalendarIntervals({
      _tag: "Cron",
      minute: 0,
      hour: 9,
      dayOfMonth: "*",
      month: "*",
      dayOfWeek: "*",
      raw: "",
    });
    expect(intervals).toHaveLength(1);
  });
});
