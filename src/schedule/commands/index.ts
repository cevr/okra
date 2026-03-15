import { Console, Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { ScheduleError } from "../errors.js";
import { StoreService, type ConditionalStop, type StopCondition } from "../services/Store.js";
import { LaunchdService } from "../services/Launchd.js";
import * as Schedule from "../services/Schedule.js";
import * as StopEvaluator from "../services/StopEvaluator.js";
import { captureContext } from "../context.js";
import { list } from "./list.js";
import { remove } from "./remove.js";
import { run } from "./run.js";
import { logs } from "./logs.js";

const parseUntilDate = Effect.fn("parseUntilDate")(function* (input: string) {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return yield* new ScheduleError({
      message: `Invalid --until date: "${input}". Use ISO 8601 or YYYY-MM-DD.`,
      code: "INVALID_DATE",
    });
  }
  // If date-only (no time component), set to end of day local time
  if (/^\d{4}-\d{2}-\d{2}$/.test(input.trim())) {
    date.setHours(23, 59, 59, 999);
  }
  return date.toISOString();
});

const root = Command.make(
  "schedule",
  {
    prompt: Argument.string("prompt").pipe(Argument.optional),
    schedule: Flag.string("schedule").pipe(Flag.withAlias("s"), Flag.optional),
    provider: Flag.choice("provider", ["claude", "codex"]).pipe(
      Flag.withAlias("p"),
      Flag.withDefault("claude" as const),
    ),
    maxRuns: Flag.integer("max-runs").pipe(Flag.optional),
    until: Flag.string("until").pipe(Flag.optional),
    stopWhen: Flag.string("stop-when").pipe(Flag.optional),
  },
  (config) =>
    Effect.gen(function* () {
      if (config.prompt._tag === "None") {
        return;
      }

      if (config.schedule._tag === "None") {
        return yield* new ScheduleError({
          message: 'Missing --schedule (-s). Usage: okra schedule "<prompt>" -s "<schedule>"',
          code: "MISSING_FLAG",
        });
      }

      const prompt = config.prompt.value;
      const scheduleStr = config.schedule.value;
      const provider = config.provider;

      const schedule = yield* Schedule.parse(scheduleStr);
      const id = yield* Effect.sync(() => crypto.randomUUID().slice(0, 8));
      const cwd = yield* Effect.sync(() => process.cwd());
      const context = yield* captureContext(cwd);

      // Build stop conditions
      const stopConditions: Array<StopCondition> = [];

      if (config.maxRuns._tag === "Some") {
        stopConditions.push({ _tag: "MaxRuns", count: config.maxRuns.value });
      }
      if (config.until._tag === "Some") {
        const date = yield* parseUntilDate(config.until.value);
        stopConditions.push({ _tag: "AfterDate", date });
      }

      // Conditional stop requires a deterministic fallback
      let conditionalStop: ConditionalStop | undefined;
      if (config.stopWhen._tag === "Some") {
        if (stopConditions.length === 0) {
          return yield* new ScheduleError({
            message:
              "--stop-when requires a deterministic fallback (--max-runs or --until). The agent could run forever without one.",
            code: "MISSING_FALLBACK",
          });
        }
        conditionalStop = { condition: config.stopWhen.value };
      }

      const store = yield* StoreService;
      const launchd = yield* LaunchdService;

      const task = yield* store.add({
        id,
        prompt,
        provider,
        schedule,
        cwd,
        context,
        stopConditions: stopConditions.length > 0 ? stopConditions : undefined,
        conditionalStop,
      });
      yield* launchd.install(task);

      yield* Console.log(`Scheduled task ${id}`);
      yield* Console.log(`  Prompt:   ${prompt}`);
      yield* Console.log(`  Provider: ${provider}`);
      yield* Console.log(`  Schedule: ${Schedule.describe(schedule)}`);
      if (task.stopConditions !== undefined && task.stopConditions.length > 0) {
        yield* Console.log(`  Stop:     ${StopEvaluator.describe(task.stopConditions, task)}`);
      }
      if (task.conditionalStop !== undefined) {
        yield* Console.log(`  When:     ${task.conditionalStop.condition}`);
      }
      yield* Console.log(`  CWD:      ${cwd}`);
      if (context !== undefined) {
        if (context.gitBranch !== undefined) yield* Console.log(`  Branch:   ${context.gitBranch}`);
        if (context.prNumber !== undefined)
          yield* Console.log(`  PR:       #${String(context.prNumber)}`);
      }
    }),
).pipe(
  Command.withDescription("Schedule AI agent tasks via macOS launchd"),
  Command.withExamples([
    {
      command: 'okra schedule "babysit this pr" -p claude -s "every weekday at 9am"',
      description: "Schedule a recurring task",
    },
    {
      command: 'okra schedule "babysit pr" -s "every day at 9am" --max-runs 5',
      description: "Stop after 5 runs",
    },
    {
      command: 'okra schedule "check deploys" -s "every weekday at 9am" --until 2026-03-20',
      description: "Stop after a date",
    },
    {
      command:
        'okra schedule "babysit pr" -s "every day at 9am" --stop-when "the PR is merged" --max-runs 20',
      description: "Stop when condition is met (with fallback)",
    },
    {
      command: 'okra schedule "run tests" -s "in 30 minutes"',
      description: "Schedule a one-shot task",
    },
    { command: "okra schedule ls", description: "List scheduled tasks" },
    { command: "okra schedule rm <id>", description: "Remove a task" },
  ]),
);

export const scheduleRoot = root.pipe(Command.withSubcommands([list, remove, run, logs]));
