import { describe, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import * as Schedule from "../../../src/schedule/services/Schedule.js";

const fixedNow = new Date("2026-03-15T12:00:00.000Z");

describe("Schedule.parse", () => {
  test("oneshot: in N minutes", async () => {
    const schedule = await Effect.runPromise(Schedule.parse("in 30 minutes", fixedNow));
    expect(schedule._tag).toBe("Oneshot");
  });

  test("oneshot: in N hours", async () => {
    const schedule = await Effect.runPromise(Schedule.parse("in 2 hours", fixedNow));
    expect(schedule._tag).toBe("Oneshot");
  });

  test("oneshot: tomorrow at", async () => {
    const schedule = await Effect.runPromise(Schedule.parse("tomorrow at 9am", fixedNow));
    expect(schedule._tag).toBe("Oneshot");
  });

  test("cron: every day at", async () => {
    const schedule = await Effect.runPromise(Schedule.parse("every day at 9am", fixedNow));
    expect(schedule._tag).toBe("Cron");
    if (schedule._tag === "Cron") {
      expect(schedule.hour).toBe(9);
      expect(schedule.minute).toBe(0);
      expect(schedule.dayOfWeek).toBe("*");
    }
  });

  test("cron: every weekday at", async () => {
    const schedule = await Effect.runPromise(Schedule.parse("every weekday at 9am", fixedNow));
    expect(schedule._tag).toBe("Cron");
    if (schedule._tag === "Cron") {
      expect(schedule.hour).toBe(9);
      expect(schedule.dayOfWeek).toBe("1-5");
    }
  });

  test("cron: every monday at", async () => {
    const schedule = await Effect.runPromise(Schedule.parse("every monday at 10:30am", fixedNow));
    expect(schedule._tag).toBe("Cron");
    if (schedule._tag === "Cron") {
      expect(schedule.hour).toBe(10);
      expect(schedule.minute).toBe(30);
      expect(schedule.dayOfWeek).toBe(1);
    }
  });

  test("cron: 5-field", async () => {
    const schedule = await Effect.runPromise(Schedule.parse("0 9 * * 1-5", fixedNow));
    expect(schedule._tag).toBe("Cron");
    if (schedule._tag === "Cron") {
      expect(schedule.minute).toBe(0);
      expect(schedule.hour).toBe(9);
    }
  });

  test("rejects invalid input", async () => {
    const exit = await Effect.runPromiseExit(Schedule.parse("not a schedule", fixedNow));
    expect(Exit.isFailure(exit)).toBe(true);
  });
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
