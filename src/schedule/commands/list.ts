import { Console, Effect, Schema } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { StoreService, Task } from "../services/Store.js";
import { describe } from "../services/Schedule.js";
import * as StopEvaluator from "../services/StopEvaluator.js";
import { isColorEnabled } from "../../shared/env.js";

const TasksJson = Schema.fromJsonString(Schema.Array(Task));
const encodeTasksJson = Schema.encodeSync(TasksJson);

/** Clips to `max` characters, spending the last 3 on an ellipsis so the width still holds. */
const truncate = (text: string, max: number): string => {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
};

const formatStopSuffix = (parts: ReadonlyArray<string>): string => {
  if (parts.length === 0) return "";
  return ` (${parts.join(", ")})`;
};

export const list = Command.make(
  "list",
  {
    json: Flag.boolean("json").pipe(Flag.withAlias("j"), Flag.withDefault(false)),
  },
  (config) =>
    Effect.gen(function* () {
      const store = yield* StoreService;
      const tasks = yield* store.list;

      if (config.json) {
        yield* Console.log(encodeTasksJson(tasks));
        return;
      }

      if (tasks.length === 0) {
        yield* Console.error("No scheduled tasks.");
        return;
      }

      yield* Console.log(
        `${"ID".padEnd(10)} ${"Provider".padEnd(10)} ${"Schedule".padEnd(30)} ${"Status".padEnd(10)} Prompt`,
      );
      if (isColorEnabled) yield* Console.log("─".repeat(90));

      for (const task of tasks) {
        const scheduleDesc = describe(task.schedule);
        const stopParts: Array<string> = [];
        if (task.stopConditions !== undefined && task.stopConditions.length > 0) {
          stopParts.push(StopEvaluator.describe(task.stopConditions, task));
        }
        if (task.conditionalStop !== undefined) {
          stopParts.push(`when: ${truncate(task.conditionalStop.condition, 20)}`);
        }
        const stopDesc = formatStopSuffix(stopParts);
        const prompt = truncate(task.prompt, 40);
        yield* Console.log(
          `${task.id.padEnd(10)} ${task.provider.padEnd(10)} ${(scheduleDesc + stopDesc).padEnd(30)} ${task.status.padEnd(10)} ${prompt}`,
        );
      }
    }),
).pipe(Command.withDescription("List active schedules"));
