import { Console, Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { ScheduleError } from "../errors.js";
import { resolvePaths } from "../paths.js";

export const logs = Command.make(
  "logs",
  {
    id: Argument.string("id").pipe(Argument.optional),
    follow: Flag.boolean("follow").pipe(Flag.withAlias("f"), Flag.withDefault(false)),
  },
  (config) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const path = yield* Path;
      const { logsDir } = yield* resolvePaths;

      const id = config.id;
      if (id._tag === "None") {
        // List available logs
        const exists = yield* fs.exists(logsDir).pipe(
          Effect.mapError(
            () =>
              new ScheduleError({
                message: `Cannot access logs dir: ${logsDir}`,
                code: "READ_FAILED",
              }),
          ),
        );
        if (!exists) {
          yield* Console.error("No logs found.");
          return;
        }
        const files = yield* fs.readDirectory(logsDir).pipe(
          Effect.mapError(
            () =>
              new ScheduleError({
                message: `Cannot read logs dir: ${logsDir}`,
                code: "READ_FAILED",
              }),
          ),
        );
        if (files.length === 0) {
          yield* Console.error("No logs found.");
          return;
        }
        yield* Console.error("Available logs:");
        for (const file of files) {
          if (file.endsWith(".log")) yield* Console.log(file.replace(".log", ""));
        }
        return;
      }

      const logFile = path.join(logsDir, `${id.value}.log`);
      const exists = yield* fs.exists(logFile).pipe(
        Effect.mapError(
          () =>
            new ScheduleError({
              message: `Cannot access log file: ${logFile}`,
              code: "READ_FAILED",
            }),
        ),
      );
      if (!exists) {
        return yield* new ScheduleError({
          message: `No logs found for task ${id.value}`,
          code: "NOT_FOUND",
        });
      }

      if (config.follow) {
        yield* Effect.acquireUseRelease(
          Effect.sync(() =>
            Bun.spawn(["tail", "-f", logFile], { stdout: "inherit", stderr: "inherit" }),
          ),
          (proc) =>
            Effect.tryPromise({
              try: () => proc.exited,
              catch: (e) =>
                new ScheduleError({
                  message: `Failed to tail log: ${e instanceof Error ? e.message : String(e)}`,
                  code: "READ_FAILED",
                }),
            }),
          (proc) => Effect.sync(() => proc.kill()),
        );
      } else {
        const content = yield* fs.readFileString(logFile).pipe(
          Effect.mapError(
            () =>
              new ScheduleError({
                message: `Cannot read log for ${id.value}`,
                code: "READ_FAILED",
              }),
          ),
        );
        yield* Console.log(content);
      }
    }),
).pipe(Command.withDescription("View task logs"));
