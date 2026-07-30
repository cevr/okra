import { Console, Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
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
          Effect.mapError(() =>
            ScheduleError.make({
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
          Effect.mapError(() =>
            ScheduleError.make({
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
        Effect.mapError(() =>
          ScheduleError.make({
            message: `Cannot access log file: ${logFile}`,
            code: "READ_FAILED",
          }),
        ),
      );
      if (!exists) {
        return yield* ScheduleError.make({
          message: `No logs found for task ${id.value}`,
          code: "NOT_FOUND",
        });
      }

      if (config.follow) {
        const spawner = yield* ChildProcessSpawner;
        // Scope kills `tail -f` on interrupt; it never exits on its own.
        yield* Effect.gen(function* () {
          const handle = yield* spawner.spawn(
            ChildProcess.make("tail", ["-f", logFile], {
              stdout: "inherit",
              stderr: "inherit",
            }),
          );
          yield* handle.exitCode;
        }).pipe(
          Effect.scoped,
          Effect.catchTag("PlatformError", (e: PlatformError) =>
            ScheduleError.make({
              message: `Failed to tail log: ${e.message}`,
              code: "READ_FAILED",
            }),
          ),
        );
      } else {
        const content = yield* fs.readFileString(logFile).pipe(
          Effect.mapError(() =>
            ScheduleError.make({
              message: `Cannot read log for ${id.value}`,
              code: "READ_FAILED",
            }),
          ),
        );
        yield* Console.log(content);
      }
    }),
).pipe(Command.withDescription("View task logs"));
