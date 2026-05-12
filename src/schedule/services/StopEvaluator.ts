import { DateTime, Option } from "effect";
import type { Task, StopCondition } from "./Store.js";

export type StopReason = {
  readonly condition: StopCondition;
  readonly description: string;
};

const evaluateOne = (
  condition: StopCondition,
  task: Task,
  nowMs: number,
): Option.Option<StopReason> => {
  switch (condition._tag) {
    case "MaxRuns": {
      if (task.runCount >= condition.count) {
        return Option.some({
          condition,
          description: `reached max runs (${String(task.runCount)}/${String(condition.count)})`,
        });
      }
      return Option.none<StopReason>();
    }
    case "AfterDate": {
      const stopMs = Date.parse(condition.date);
      if (nowMs > stopMs) {
        return Option.some({
          condition,
          description: `past stop date (${condition.date})`,
        });
      }
      return Option.none<StopReason>();
    }
  }
};

export const evaluate = (task: Task, nowMs: number): Option.Option<StopReason> => {
  if (task.stopConditions === undefined || task.stopConditions.length === 0) {
    return Option.none<StopReason>();
  }
  for (const condition of task.stopConditions) {
    const result = evaluateOne(condition, task, nowMs);
    if (Option.isSome(result)) return result;
  }
  return Option.none<StopReason>();
};

const formatDate = (iso: string): string => {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const parts = DateTime.toParts(DateTime.makeUnsafe(ms));
  const yyyy = String(parts.year).padStart(4, "0");
  const mm = String(parts.month).padStart(2, "0");
  const dd = String(parts.day).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

export const describe = (conditions: ReadonlyArray<StopCondition>, task: Task): string => {
  const parts: Array<string> = [];
  for (const c of conditions) {
    switch (c._tag) {
      case "MaxRuns":
        parts.push(`${String(task.runCount)}/${String(c.count)} runs`);
        break;
      case "AfterDate":
        parts.push(`until ${formatDate(c.date)}`);
        break;
    }
  }
  return parts.join(", ");
};
