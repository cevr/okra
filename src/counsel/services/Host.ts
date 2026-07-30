import { Config, Effect, Layer, Context, Option, Stream } from "effect";
import type { PlatformError } from "effect/PlatformError";
import { Stdio } from "effect/Stdio";
import { CounselError, ErrorCode } from "../errors.js";

/** The env markers that identify which agent is invoking okra. */
const AGENT_MARKER_KEYS = [
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CODEX_THREAD_ID",
  "CODEX_CI",
] as const;

export class HostService extends Context.Service<
  HostService,
  {
    readonly getCwd: Effect.Effect<string>;
    /** Only the agent-detection markers, read through Config rather than the raw env map. */
    readonly getAgentMarkers: Effect.Effect<Record<string, string | undefined>>;
    readonly readPipedStdin: Effect.Effect<string | undefined, CounselError>;
    readonly setExitCode: (code: number) => Effect.Effect<void>;
  }
>()("@cvr/okra/counsel/services/Host/HostService") {
  static layer: Layer.Layer<HostService, never, Stdio> = Layer.effect(
    HostService,
    Effect.gen(function* () {
      const stdio = yield* Stdio;

      return {
        getCwd: Effect.sync(() => process.cwd()),
        getAgentMarkers: Effect.forEach(AGENT_MARKER_KEYS, (key) =>
          Config.option(Config.string(key)).pipe(
            Effect.map((value) => [key, Option.getOrUndefined(value)] as const),
            Effect.orElseSucceed(() => [key, undefined] as const),
          ),
        ).pipe(Effect.map((entries) => Object.fromEntries(entries))),
        readPipedStdin: Effect.gen(function* () {
          // An interactive terminal means nothing was piped in.
          if (process.stdin.isTTY) {
            return undefined;
          }
          const text = yield* Stream.mkString(Stream.decodeText(stdio.stdin)).pipe(
            Effect.mapError((error: PlatformError) =>
              CounselError.make({ message: error.message, code: ErrorCode.READ_FAILED }),
            ),
          );
          if (text.length > 0) return text;
          return undefined;
        }),
        setExitCode: (code) =>
          Effect.sync(() => {
            process.exitCode = code;
          }),
      };
    }),
  );

  static layerTest = (
    impl: Partial<Context.Service.Shape<typeof HostService>> = {},
  ): Layer.Layer<HostService> =>
    Layer.succeed(HostService, {
      getCwd: Effect.succeed("/tmp/counsel-test"),
      getAgentMarkers: Effect.succeed({}),
      readPipedStdin: Effect.as(Effect.void, undefined as string | undefined),
      setExitCode: () => Effect.void,
      ...impl,
    });
}
