import { Clock, Console, Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import { Argument, Command } from "effect/unstable/cli";
import { buildXpPaths } from "../paths.js";
import { ResearchError, ErrorCode } from "../errors.js";

export const steerCommand = Command.make(
  "steer",
  {
    guidance: Argument.string("guidance").pipe(Argument.withDescription("Guidance for the agent")),
  },
  ({ guidance }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const path = yield* Path;
      const projectRoot = process.cwd();
      const paths = buildXpPaths(path, projectRoot);

      const wrap = (e: PlatformError) =>
        new ResearchError({
          message: `Failed to write steer file: ${e.message}`,
          code: ErrorCode.WRITE_FAILED,
        });

      yield* fs.makeDirectory(paths.steerDir, { recursive: true }).pipe(Effect.mapError(wrap));
      const nowMs = yield* Clock.currentTimeMillis;
      const filename = `${String(nowMs)}.txt`;
      yield* fs
        .writeFileString(path.join(paths.steerDir, filename), guidance)
        .pipe(Effect.mapError(wrap));
      yield* Console.error(`Steer queued: ${filename}`);
    }),
).pipe(Command.withDescription("Send guidance to the experiment"));
