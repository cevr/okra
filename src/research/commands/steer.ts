// @effect-diagnostics effect/nodeBuiltinImport:off
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Console, Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";
import { xpPaths } from "../paths.js";

export const steerCommand = Command.make(
  "steer",
  {
    guidance: Argument.string("guidance").pipe(Argument.withDescription("Guidance for the agent")),
  },
  ({ guidance }) =>
    Effect.gen(function* () {
      const projectRoot = process.cwd();
      const paths = xpPaths(projectRoot);

      mkdirSync(paths.steerDir, { recursive: true });
      const filename = `${Date.now()}.txt`;
      writeFileSync(join(paths.steerDir, filename), guidance);
      yield* Console.log(`Steer queued: ${filename}`);
    }),
).pipe(Command.withDescription("Send guidance to the experiment"));
