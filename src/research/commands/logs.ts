import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { Command, Flag } from "effect/unstable/cli";
import { buildXpPaths } from "../paths.js";
import { ResearchError, ErrorCode } from "../errors.js";

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

      const exists = yield* fs
        .exists(paths.daemonLog)
        .pipe(Effect.catch(() => Effect.succeed(false)));
      if (!exists) {
        return yield* new ResearchError({
          message: "No daemon log found. Start an experiment first.",
          code: ErrorCode.READ_FAILED,
        });
      }

      const args = follow ? ["tail", "-f", paths.daemonLog] : ["cat", paths.daemonLog];
      const proc = Bun.spawn(args, {
        stdout: "inherit",
        stderr: "inherit",
      });
      yield* Effect.tryPromise({
        try: () => proc.exited,
        catch: () =>
          new ResearchError({
            message: "Failed to read logs",
            code: ErrorCode.READ_FAILED,
          }),
      });
    }),
).pipe(Command.withDescription("View daemon logs"));
