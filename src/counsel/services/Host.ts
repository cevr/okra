import { Effect, Layer, ServiceMap } from "effect";
import { CounselError, ErrorCode } from "../errors.js";

export class HostService extends ServiceMap.Service<
  HostService,
  {
    readonly getCwd: () => Effect.Effect<string>;
    readonly getEnv: () => Effect.Effect<Record<string, string | undefined>>;
    readonly readPipedStdin: () => Effect.Effect<string | undefined, CounselError>;
    readonly setExitCode: (code: number) => Effect.Effect<void>;
  }
>()("@cvr/okra/counsel/services/Host/HostService") {
  static layer: Layer.Layer<HostService> = Layer.succeed(HostService, {
    getCwd: () => Effect.sync(() => process.cwd()),
    getEnv: () => Effect.succeed(process.env),
    readPipedStdin: () =>
      Effect.tryPromise({
        try: async () => {
          if (process.stdin.isTTY) {
            return undefined;
          }

          const text = await new Response(Bun.stdin.stream()).text();
          return text.length > 0 ? text : undefined;
        },
        catch: (error) =>
          new CounselError({
            message: error instanceof Error ? error.message : String(error),
            code: ErrorCode.READ_FAILED,
          }),
      }),
    setExitCode: (code) =>
      Effect.sync(() => {
        process.exitCode = code;
      }),
  });

  static layerTest = (
    impl: Partial<ServiceMap.Service.Shape<typeof HostService>> = {},
  ): Layer.Layer<HostService> =>
    Layer.succeed(HostService, {
      getCwd: () => Effect.succeed("/tmp/counsel-test"),
      getEnv: () => Effect.succeed({}),
      readPipedStdin: () => Effect.as(Effect.void, undefined as string | undefined),
      setExitCode: () => Effect.void,
      ...impl,
    });
}
