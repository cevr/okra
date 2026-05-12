import { Clock, Effect, Layer, Context } from "effect";
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

/**
 * Terminate process: SIGTERM, wait grace period, then SIGKILL.
 * Fork-and-forget so callers don't block on the grace period.
 */
const terminate = (proc: Bun.Subprocess) =>
  Effect.gen(function* () {
    proc.kill("SIGTERM");
    yield* Effect.sleep(KILL_GRACE_PERIOD_MS);
    proc.kill("SIGKILL");
  });

const awaitExit = (proc: Bun.Subprocess): Effect.Effect<number, CounselError> =>
  Effect.tryPromise({
    try: () => proc.exited,
    catch: spawnFailed,
  });

const waitForExit = Effect.fn("InvocationRunner.waitForExit")(function* (
  proc: Bun.Subprocess,
  timeoutSeconds: number,
) {
  // Race process exit against timeout.
  const result = yield* Effect.raceFirst(
    awaitExit(proc).pipe(Effect.map((exitCode) => ({ exitCode, timedOut: false }))),
    Effect.sleep(timeoutSeconds * 1_000).pipe(Effect.as({ exitCode: -1, timedOut: true } as const)),
    // On interrupt (signal/abort) or timeout-branch win, fire terminate as a finalizer
  ).pipe(Effect.onInterrupt(() => Effect.forkDetach(terminate(proc)).pipe(Effect.asVoid)));

  if (result.timedOut) {
    // Ensure process is terminated; await its actual exit code.
    yield* Effect.forkDetach(terminate(proc));
    const exitCode = yield* awaitExit(proc);
    return { exitCode, timedOut: true };
  }

  return result;
});

export class InvocationRunnerService extends Context.Service<
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
    impl: Partial<Context.Service.Shape<typeof InvocationRunnerService>> = {},
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
