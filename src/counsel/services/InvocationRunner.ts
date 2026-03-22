import { Clock, Effect, Layer, ServiceMap } from "effect";
import { DEFAULT_TIMEOUT_SECONDS, KILL_GRACE_PERIOD_MS } from "../constants.js";
import { CounselError, ErrorCode } from "../errors.js";
import type { ExecutionResult, Invocation } from "../types.js";

const spawnFailed = (error: unknown): CounselError =>
  new CounselError({
    message: error instanceof Error ? error.message : String(error),
    code: ErrorCode.SPAWN_FAILED,
  });

const spawnProcess = (invocation: Invocation, outputFile: string, stderrFile: string) =>
  Effect.try({
    try: () =>
      Bun.spawn([invocation.cmd, ...invocation.args], {
        cwd: invocation.cwd,
        stdin: "ignore",
        stdout: Bun.file(outputFile),
        stderr: Bun.file(stderrFile),
      }),
    catch: spawnFailed,
  });

const waitForExit = Effect.fn("InvocationRunner.waitForExit")(function* (
  proc: Bun.Subprocess,
  timeoutSeconds: number,
) {
  return yield* Effect.callback<
    { readonly exitCode: number; readonly timedOut: boolean },
    CounselError
  >((resume, signal) => {
    let finished = false;
    let timedOut = false;
    let terminating = false;
    let forceKill: ReturnType<typeof setTimeout> | undefined;

    const clearTimers = () => {
      clearTimeout(timeout);
      if (forceKill !== undefined) {
        clearTimeout(forceKill);
      }
    };

    const terminate = () => {
      if (terminating) {
        return;
      }

      terminating = true;
      proc.kill("SIGTERM");
      forceKill = setTimeout(() => {
        proc.kill("SIGKILL");
      }, KILL_GRACE_PERIOD_MS);
    };

    const finish = (
      effect: Effect.Effect<
        { readonly exitCode: number; readonly timedOut: boolean },
        CounselError
      >,
    ) => {
      if (finished) {
        return;
      }

      finished = true;
      signal.removeEventListener("abort", onAbort);
      clearTimers();
      resume(effect);
    };

    const onAbort = () => {
      terminate();
    };

    signal.addEventListener("abort", onAbort, { once: true });

    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutSeconds * 1_000);

    void proc.exited.then(
      (exitCode) => {
        finish(Effect.succeed({ exitCode, timedOut }));
      },
      (error) => {
        finish(Effect.fail(spawnFailed(error)));
      },
    );

    return Effect.sync(() => {
      signal.removeEventListener("abort", onAbort);
      clearTimers();
      if (!finished) {
        terminate();
      }
    });
  });
});

export class InvocationRunnerService extends ServiceMap.Service<
  InvocationRunnerService,
  {
    readonly execute: (
      invocation: Invocation,
      outputFile: string,
      stderrFile: string,
      timeoutSeconds?: number,
    ) => Effect.Effect<ExecutionResult, CounselError>;
  }
>()("@cvr/okra/counsel/services/InvocationRunner/InvocationRunnerService") {
  static layer: Layer.Layer<InvocationRunnerService> = Layer.succeed(InvocationRunnerService, {
    execute: (invocation, outputFile, stderrFile, timeoutSeconds = DEFAULT_TIMEOUT_SECONDS) =>
      Effect.gen(function* () {
        const startedAt = yield* Clock.currentTimeMillis;
        const proc = yield* spawnProcess(invocation, outputFile, stderrFile);
        const execution = yield* waitForExit(proc, timeoutSeconds);
        const finishedAt = yield* Clock.currentTimeMillis;
        return {
          exitCode: execution.exitCode,
          durationMs: finishedAt - startedAt,
          timedOut: execution.timedOut,
        };
      }),
  });

  static layerTest = (
    impl: Partial<ServiceMap.Service.Shape<typeof InvocationRunnerService>> = {},
  ): Layer.Layer<InvocationRunnerService> =>
    Layer.succeed(InvocationRunnerService, {
      execute: () =>
        Effect.succeed({
          exitCode: 0,
          durationMs: 0,
          timedOut: false,
        }),
      ...impl,
    });
}
