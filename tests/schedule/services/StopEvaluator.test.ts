import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import * as StopEvaluator from "../../../src/schedule/services/StopEvaluator.js";
import { Task } from "../../../src/schedule/services/Store.js";

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

  test("AfterDate: returns none for future date", () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const task = makeTask({ stopConditions: [{ _tag: "AfterDate", date: future }] });
    expect(Option.isNone(StopEvaluator.evaluate(task))).toBe(true);
  });

  test("AfterDate: returns some for past date", () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const task = makeTask({ stopConditions: [{ _tag: "AfterDate", date: past }] });
    expect(Option.isSome(StopEvaluator.evaluate(task))).toBe(true);
  });

  test("no conditions returns none", () => {
    const task = makeTask({});
    expect(Option.isNone(StopEvaluator.evaluate(task))).toBe(true);
  });
});

describe("StopEvaluator.describe", () => {
  test("formats MaxRuns", () => {
    const task = makeTask({ runCount: 3 });
    const desc = StopEvaluator.describe([{ _tag: "MaxRuns", count: 5 }], task);
    expect(desc).toBe("3/5 runs");
  });
});
