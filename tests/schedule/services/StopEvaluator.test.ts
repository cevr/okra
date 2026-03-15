import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import * as StopEvaluator from "../../../src/schedule/services/StopEvaluator.js";
import { Task, type StopCondition } from "../../../src/schedule/services/Store.js";

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

describe("StopEvaluator.evaluate", () => {
  test("MaxRuns: returns none when under limit", () => {
    const task = makeTask({ runCount: 3, stopConditions: [{ _tag: "MaxRuns", count: 5 }] });
    expect(Option.isNone(StopEvaluator.evaluate(task))).toBe(true);
  });

  test("MaxRuns: returns some when at limit", () => {
    const task = makeTask({ runCount: 5, stopConditions: [{ _tag: "MaxRuns", count: 5 }] });
    expect(Option.isSome(StopEvaluator.evaluate(task))).toBe(true);
  });

  test("MaxRuns: returns some when runCount exceeds maxRuns", () => {
    const task = makeTask({ runCount: 7, stopConditions: [{ _tag: "MaxRuns", count: 5 }] });
    expect(Option.isSome(StopEvaluator.evaluate(task))).toBe(true);
  });

  test("AfterDate: returns none for future date", () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const task = makeTask({ stopConditions: [{ _tag: "AfterDate", date: future }] });
    expect(Option.isNone(StopEvaluator.evaluate(task))).toBe(true);
  });

  test("AfterDate: returns some for past date", () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const task = makeTask({ stopConditions: [{ _tag: "AfterDate", date: past }] });
    const result = StopEvaluator.evaluate(task);
    expect(Option.isSome(result)).toBe(true);
    if (Option.isSome(result)) {
      expect(result.value.condition._tag).toBe("AfterDate");
    }
  });

  test("multiple conditions: returns first matching (OR semantics)", () => {
    const task = makeTask({
      runCount: 10,
      stopConditions: [
        { _tag: "MaxRuns", count: 5 },
        { _tag: "AfterDate", date: new Date(Date.now() + 86400000).toISOString() },
      ],
    });
    const result = StopEvaluator.evaluate(task);
    expect(Option.isSome(result)).toBe(true);
    if (Option.isSome(result)) {
      expect(result.value.condition._tag).toBe("MaxRuns");
    }
  });

  test("multiple conditions: returns none when none match", () => {
    const task = makeTask({
      runCount: 2,
      stopConditions: [
        { _tag: "MaxRuns", count: 5 },
        { _tag: "AfterDate", date: new Date(Date.now() + 86400000).toISOString() },
      ],
    });
    expect(Option.isNone(StopEvaluator.evaluate(task))).toBe(true);
  });

  test("no conditions returns none", () => {
    const task = makeTask({});
    expect(Option.isNone(StopEvaluator.evaluate(task))).toBe(true);
  });

  test("empty conditions array returns none", () => {
    const task = makeTask({ stopConditions: [] });
    expect(Option.isNone(StopEvaluator.evaluate(task))).toBe(true);
  });
});

describe("StopEvaluator.describe", () => {
  test("formats MaxRuns", () => {
    const task = makeTask({ runCount: 3 });
    const desc = StopEvaluator.describe([{ _tag: "MaxRuns", count: 5 }], task);
    expect(desc).toBe("3/5 runs");
  });

  test("formats AfterDate", () => {
    const task = makeTask();
    const conditions: ReadonlyArray<StopCondition> = [
      { _tag: "AfterDate", date: "2026-03-20T23:59:59.999Z" },
    ];
    const result = StopEvaluator.describe(conditions, task);
    expect(result).toContain("until");
    expect(result).toContain("3/20/2026");
  });

  test("formats multiple conditions", () => {
    const task = makeTask({ runCount: 1 });
    const conditions: ReadonlyArray<StopCondition> = [
      { _tag: "MaxRuns", count: 10 },
      { _tag: "AfterDate", date: "2026-12-31T23:59:59.999Z" },
    ];
    expect(StopEvaluator.describe(conditions, task)).toBe("1/10 runs, until 12/31/2026");
  });
});
