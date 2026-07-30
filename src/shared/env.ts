import { Config, Effect, Option } from "effect";

/**
 * Colour is on only for an interactive stdout with no NO_COLOR override.
 * Reading `isTTY` directly is sanctioned; NO_COLOR is read through Config so a
 * caller can override it without mutating the process environment.
 */
export const isColorEnabled: Effect.Effect<boolean> = Config.option(Config.string("NO_COLOR")).pipe(
  Effect.map((noColor) => Option.isNone(noColor) && process.stdout.isTTY === true),
  Effect.orElseSucceed(() => false),
);
