import { Console, Effect } from "effect";
import { Command } from "effect/unstable/cli";
import { DaemonService } from "../services/Daemon.js";

export const stopCommand = Command.make("stop", {}, () =>
  Effect.gen(function* () {
    const daemon = yield* DaemonService;
    const projectRoot = process.cwd();

    yield* daemon.stop(projectRoot);
    yield* Console.log("Daemon stopped.");
  }),
).pipe(Command.withDescription("Stop the experiment daemon"));
