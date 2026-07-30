import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { Command, Flag } from "effect/unstable/cli";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import { buildXpPaths } from "../paths.js";
import { ResearchError, ErrorCode } from "../errors.js";

const LOG_STDIO = { stdout: "inherit", stderr: "inherit" } as const;

const buildLogCommand = (follow: boolean, logPath: string): ChildProcess.Command => {
  if (follow) return ChildProcess.make("tail", ["-f", logPath], LOG_STDIO);
  return ChildProcess.make("cat", [logPath], LOG_STDIO);
};

export const logsCommand = Command.make(
  "logs",
  {
    follow: Flag.boolean("follow").pipe(
      Flag.withAlias("f"),
      Flag.withDefault(false),
      Flag.withDescription("Follow log output"),
    ),
  },
  ({ follow }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const path = yield* Path;
      const projectRoot = process.cwd();
      const paths = buildXpPaths(path, projectRoot);

      const exists = yield* fs.exists(paths.daemonLog).pipe(Effect.orElseSucceed(() => false));
      if (!exists) {
        return yield* ResearchError.make({
          message: "No daemon log found. Start an experiment first.",
          code: ErrorCode.READ_FAILED,
        });
      }

      const spawner = yield* ChildProcessSpawner;
      const command = buildLogCommand(follow, paths.daemonLog);
      yield* spawner.exitCode(command).pipe(
        Effect.catchTag("PlatformError", () =>
          ResearchError.make({
            message: "Failed to read logs",
            code: ErrorCode.READ_FAILED,
          }),
        ),
      );
    }),
).pipe(Command.withDescription("View daemon logs"));
