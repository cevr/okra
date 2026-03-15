import { Config, Effect } from "effect";
import { Path } from "effect/Path";
import { ScheduleError } from "./errors.js";

export const PathEnv = Config.withDefault(
  Config.string("PATH"),
  process.env["PATH"] ?? "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
);

const Home = Config.string("HOME")
  .asEffect()
  .pipe(
    Effect.mapError(
      () =>
        new ScheduleError({ message: "HOME environment variable not set", code: "CONFIG_ERROR" }),
    ),
  );

export const resolvePaths = Effect.gen(function* () {
  const path = yield* Path;
  const home = yield* Home;
  return {
    baseDir: path.join(home, ".okra", "schedule"),
    tasksDir: path.join(home, ".okra", "schedule", "tasks"),
    logsDir: path.join(home, ".okra", "schedule", "logs"),
    agentsDir: path.join(home, "Library", "LaunchAgents"),
    home,
  } as const;
});
