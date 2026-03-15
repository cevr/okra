import { Console, Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";
import { FileSystem } from "effect/FileSystem";
import { StoreService } from "../services/Store.js";
import { LaunchdService } from "../services/Launchd.js";
import { resolvePaths } from "../paths.js";
import { Path } from "effect/Path";

export const remove = Command.make("rm", { id: Argument.string("id") }, (config) =>
  Effect.gen(function* () {
    const store = yield* StoreService;
    const launchd = yield* LaunchdService;
    const fs = yield* FileSystem;
    const path = yield* Path;
    const { logsDir } = yield* resolvePaths;

    yield* launchd.uninstall(config.id);
    yield* store.remove(config.id);
    yield* fs.remove(path.join(logsDir, `${config.id}.log`)).pipe(Effect.catch(() => Effect.void));
    yield* Console.log(`Removed task ${config.id}`);
  }),
).pipe(Command.withDescription("Remove a scheduled task"));
