import { Argument, Command, Flag } from "effect/unstable/cli";
import { Console, Effect, Option } from "effect";
import { VaultService } from "../services/Vault.js";

const dirArg = Argument.string("dir").pipe(
  Argument.withDescription("Path to markdown directory to snapshot"),
);
const outputFlag = Flag.string("output").pipe(
  Flag.optional,
  Flag.withAlias("o"),
  Flag.withDescription("Write snapshot to file instead of stdout"),
);
const jsonFlag = Flag.boolean("json").pipe(Flag.withDescription("Output as JSON"));

export const snapshot = Command.make("snapshot", {
  dir: dirArg,
  output: outputFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Create a single-file snapshot of a markdown directory"),
  Command.withHandler(({ dir, output, json }) =>
    Effect.gen(function* () {
      const vault = yield* VaultService;
      // output is already Option<string>, pass directly
      const result = yield* vault.snapshot(dir, output);

      if (json && Option.isSome(output)) {
        // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
        yield* Console.log(JSON.stringify({ path: result }));
      } else if (Option.isSome(output)) {
        yield* Console.error(`Wrote snapshot to ${result}`);
      } else {
        // stdout content — JSON wrapping raw markdown is useless
        yield* Console.log(result);
      }
    }),
  ),
);
