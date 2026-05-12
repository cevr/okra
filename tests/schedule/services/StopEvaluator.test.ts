import { describe, expect, it } from "effect-bun-test";
import { Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import * as StopEvaluator from "../../../src/schedule/services/StopEvaluator.js";
import { Task, type StopCondition } from "../../../src/schedule/services/Store.js";

// 2026-03-15T12:00:00.000Z in milliseconds
const FIXED_NOW_MS = 1773576000000;

const makeTask = (overrides: Partial<Task> = {}): Task =>
  new Task({
    id: "test",
    prompt: "test",
    provider: "claude",
    schedule: {
      _tag: "Cron",
      minute: 0,
      hour: 9,
      dayOfMonth: "*",
      month: "*",
      dayOfWeek: "*",
      raw: "",
    },
    cwd: "/tmp",
    createdAt: "2026-01-01T00:00:00Z",
    status: "active",
    runCount: 0,
    ...overrides,
  });

const FUTURE_ISO = "2026-03-16T12:00:00.000Z"; // FIXED_NOW_MS + 1 day
const PAST_ISO = "2026-03-14T12:00:00.000Z"; // FIXED_NOW_MS - 1 day

describe("StopEvaluator.evaluate", () => {
  it.effect("MaxRuns: returns none when under limit", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(FIXED_NOW_MS);
      const task = makeTask({ runCount: 3, stopConditions: [{ _tag: "MaxRuns", count: 5 }] });
      expect(Option.isNone(StopEvaluator.evaluate(task, FIXED_NOW_MS))).toBe(true);
    }),
  );

  it.effect("MaxRuns: returns some when at limit", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(FIXED_NOW_MS);
      const task = makeTask({ runCount: 5, stopConditions: [{ _tag: "MaxRuns", count: 5 }] });
      expect(Option.isSome(StopEvaluator.evaluate(task, FIXED_NOW_MS))).toBe(true);
    }),
  );

  it.effect("MaxRuns: returns some when runCount exceeds maxRuns", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(FIXED_NOW_MS);
      const task = makeTask({ runCount: 7, stopConditions: [{ _tag: "MaxRuns", count: 5 }] });
      expect(Option.isSome(StopEvaluator.evaluate(task, FIXED_NOW_MS))).toBe(true);
    }),
  );

  it.effect("AfterDate: returns none for future date", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(FIXED_NOW_MS);
      const task = makeTask({ stopConditions: [{ _tag: "AfterDate", date: FUTURE_ISO }] });
      expect(Option.isNone(StopEvaluator.evaluate(task, FIXED_NOW_MS))).toBe(true);
    }),
  );

  it.effect("AfterDate: returns some for past date", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(FIXED_NOW_MS);
      const task = makeTask({ stopConditions: [{ _tag: "AfterDate", date: PAST_ISO }] });
      const result = StopEvaluator.evaluate(task, FIXED_NOW_MS);
      expect(Option.isSome(result)).toBe(true);
      if (Option.isSome(result)) {
        expect(result.value.condition._tag).toBe("AfterDate");
      }
    }),
  );

  it.effect("multiple conditions: returns first matching (OR semantics)", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(FIXED_NOW_MS);
      const task = makeTask({
        runCount: 10,
        stopConditions: [
          { _tag: "MaxRuns", count: 5 },
          { _tag: "AfterDate", date: FUTURE_ISO },
        ],
      });
      const result = StopEvaluator.evaluate(task, FIXED_NOW_MS);
      expect(Option.isSome(result)).toBe(true);
      if (Option.isSome(result)) {
        expect(result.value.condition._tag).toBe("MaxRuns");
      }
    }),
  );

  it.effect("multiple conditions: returns none when none match", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(FIXED_NOW_MS);
      const task = makeTask({
        runCount: 2,
        stopConditions: [
          { _tag: "MaxRuns", count: 5 },
          { _tag: "AfterDate", date: FUTURE_ISO },
        ],
      });
      expect(Option.isNone(StopEvaluator.evaluate(task, FIXED_NOW_MS))).toBe(true);
    }),
  );

  it.effect("no conditions returns none", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(FIXED_NOW_MS);
      const task = makeTask({});
      expect(Option.isNone(StopEvaluator.evaluate(task, FIXED_NOW_MS))).toBe(true);
    }),
  );

  it.effect("empty conditions array returns none", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(FIXED_NOW_MS);
      const task = makeTask({ stopConditions: [] });
      expect(Option.isNone(StopEvaluator.evaluate(task, FIXED_NOW_MS))).toBe(true);
    }),
  );
});

describe("StopEvaluator.describe", () => {
  it.effect("formats MaxRuns", () =>
    Effect.sync(() => {
      const task = makeTask({ runCount: 3 });
      const desc = StopEvaluator.describe([{ _tag: "MaxRuns", count: 5 }], task);
      expect(desc).toBe("3/5 runs");
    }),
  );

  it.effect("formats AfterDate", () =>
    Effect.sync(() => {
      const task = makeTask();
      const conditions: ReadonlyArray<StopCondition> = [
        { _tag: "AfterDate", date: "2026-03-20T23:59:59.999Z" },
      ];
      const result = StopEvaluator.describe(conditions, task);
      expect(result).toContain("until");
      expect(result).toContain("2026-03-20");
    }),
  );

  it.effect("formats multiple conditions", () =>
    Effect.sync(() => {
      const task = makeTask({ runCount: 1 });
      const conditions: ReadonlyArray<StopCondition> = [
        { _tag: "MaxRuns", count: 10 },
        { _tag: "AfterDate", date: "2026-12-31T23:59:59.999Z" },
      ];
      expect(StopEvaluator.describe(conditions, task)).toBe("1/10 runs, until 2026-12-31");
    }),
  );
});
