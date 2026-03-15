import { Effect, Layer, Ref, ServiceMap } from "effect";
import { BrainError } from "../errors/index.js";

export interface ClaudeInvocation {
  readonly prompt: string;
  readonly model: string;
}

export class ClaudeService extends ServiceMap.Service<
  ClaudeService,
  {
    readonly invoke: (prompt: string, model: string) => Effect.Effect<void, BrainError>;
  }
>()("@cvr/okra/brain/services/Claude/ClaudeService") {
  static layer: Layer.Layer<ClaudeService> = Layer.succeed(ClaudeService, {
    invoke: Effect.fn("ClaudeService.invoke")(function* (prompt: string, model: string) {
      yield* Effect.tryPromise({
        try: async () => {
          const proc = Bun.spawn(
            [
              "claude",
              "-p",
              prompt,
              "--dangerously-skip-permissions",
              "--model",
              model,
              "--no-session-persistence",
            ],
            { stdout: "ignore", stderr: "inherit" },
          );
          const code = await proc.exited;
          if (code !== 0) throw new Error(`claude exited with code ${code}`);
        },
        catch: (e) =>
          new BrainError({
            message: `Claude invocation failed: ${e instanceof Error ? e.message : String(e)}`,
            code: "SPAWN_FAILED",
          }),
      });
    }),
  });

  static layerTest = (ref: Ref.Ref<Array<ClaudeInvocation>>) =>
    Layer.succeed(ClaudeService, {
      invoke: (prompt, model) => Ref.update(ref, (arr) => [...arr, { prompt, model }]),
    });

  static layerNoop = Layer.succeed(ClaudeService, {
    invoke: () => Effect.void,
  });
}
