import { Console, Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { StoreService } from "../services/Store.js";
import { describe } from "../services/Schedule.js";
import * as StopEvaluator from "../services/StopEvaluator.js";
import { isColorEnabled } from "../../shared/env.js";

export const list = Command.make(
  "ls",
  {
    json: Flag.boolean("json").pipe(Flag.withAlias("j"), Flag.withDefault(false)),
  },
  (config) =>
    Effect.gen(function* () {
      const store = yield* StoreService;
      const tasks = yield* store.list();

      if (config.json) {
        const out = tasks.map((t) => ({
          id: t.id,
          prompt: t.prompt,
          provider: t.provider,
          schedule: t.schedule,
          cwd: t.cwd,
          status: t.status,
          createdAt: t.createdAt,
          lastRun: t.lastRun,
          runCount: t.runCount,
          context: t.context,
          stopConditions: t.stopConditions,
          conditionalStop: t.conditionalStop,
        }));
        // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
        yield* Console.log(JSON.stringify(out, null, 2));
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
          const cond = task.conditionalStop.condition;
          stopParts.push(`when: ${cond.length > 20 ? `${cond.slice(0, 17)}...` : cond}`);
        }
        const stopDesc = stopParts.length > 0 ? ` (${stopParts.join(", ")})` : "";
        const prompt = task.prompt.length > 40 ? `${task.prompt.slice(0, 37)}...` : task.prompt;
        yield* Console.log(
          `${task.id.padEnd(10)} ${task.provider.padEnd(10)} ${(scheduleDesc + stopDesc).padEnd(30)} ${task.status.padEnd(10)} ${prompt}`,
        );
      }
    }),
).pipe(Command.withDescription("List active schedules"));
