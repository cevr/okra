import { Option } from "effect";
import type { Task, StopCondition } from "./Store.js";

export type StopReason = {
  readonly condition: StopCondition;
  readonly description: string;
};

const evaluateOne = (condition: StopCondition, task: Task): Option.Option<StopReason> => {
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
      if (new Date() > new Date(condition.date)) {
        return Option.some({
          condition,
          description: `past stop date (${condition.date})`,
        });
      }
      return Option.none<StopReason>();
    }
  }
};

export const evaluate = (task: Task): Option.Option<StopReason> => {
  if (task.stopConditions === undefined || task.stopConditions.length === 0) {
    return Option.none<StopReason>();
  }
  for (const condition of task.stopConditions) {
    const result = evaluateOne(condition, task);
    if (Option.isSome(result)) return result;
  }
  return Option.none<StopReason>();
};

export const describe = (conditions: ReadonlyArray<StopCondition>, task: Task): string => {
  const parts: Array<string> = [];
  for (const c of conditions) {
    switch (c._tag) {
      case "MaxRuns":
        parts.push(`${String(task.runCount)}/${String(c.count)} runs`);
        break;
      case "AfterDate":
        parts.push(`until ${new Date(c.date).toLocaleDateString()}`);
        break;
    }
  }
  return parts.join(", ");
};
