import { Config, ConfigProvider, Deferred, Effect, Fiber, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { ResearchError, ErrorCode } from "../errors.js";
import { LoopService } from "../services/Loop.js";
import { DaemonService } from "../services/Daemon.js";

const readInternal = Config.option(Config.string("OKRA_INTERNAL")).parse(ConfigProvider.fromEnv());

export const loopCommand = Command.make(
  "_loop",
  {
    projectRoot: Flag.string("project-root").pipe(Flag.withDescription("Project root directory")),
  },
  ({ projectRoot }) =>
    Effect.gen(function* () {
      // Guard: only callable by the daemon
      const internalOpt = yield* readInternal.pipe(
        Effect.mapError(
          () =>
            new ResearchError({
              message: "Cannot read OKRA_INTERNAL",
              code: ErrorCode.AGENT_FAILED,
            }),
        ),
      );
      const internal = Option.getOrElse(internalOpt, () => "");
      if (internal !== "1") {
        return yield* new ResearchError({
          message: "This command is for internal use only",
          code: ErrorCode.AGENT_FAILED,
        });
      }

      const loop = yield* LoopService;
      const daemon = yield* DaemonService;

      // Write own pid
      yield* daemon.writePid(projectRoot, process.pid);

      // Create a deferred that resolves on SIGTERM
      const shutdown = yield* Deferred.make<void>();
      const services = yield* Effect.context<never>();
      process.on("SIGTERM", () => {
        Effect.runForkWith(services)(
          Effect.andThen(
            Effect.logInfo("Received SIGTERM, shutting down..."),
            Deferred.succeed(shutdown, undefined),
          ),
        );
      });

      // Fork the loop, then race against SIGTERM
      const fiber = yield* Effect.forkChild(loop.run(projectRoot));
      yield* Effect.race(Fiber.join(fiber), Deferred.await(shutdown));

      // Interrupt the loop fiber if still running (SIGTERM case)
      yield* Fiber.interrupt(fiber);

      yield* daemon.cleanPid(projectRoot);
    }),
).pipe(Command.withDescription("Internal: run the experiment loop"));
