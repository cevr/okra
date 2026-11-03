import { Config, Effect, Option } from "effect";

export const isColorEnabled: Effect.Effect<boolean> = Config.option(Config.String("NO_COLOR")).pipe(
  Effect.map((noColor) => Option.isNone(noColor) && process.stdout.isTTY === true),
  Effect.orElseSucceed(() => false),
);
