import { Clock, Effect, Layer, Context, Stream } from "effect";
import { FileSystem } from "effect/FileSystem";
import type { PlatformError } from "effect/PlatformError";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import type { ChildProcessHandle } from "effect/unstable/process/ChildProcessSpawner";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import { DEFAULT_TIMEOUT_SECONDS, KILL_GRACE_PERIOD_MS } from "../constants.js";
import { CounselError, ErrorCode } from "../errors.js";
import type { ExecutionResult, Invocation } from "../types.js";

const spawnFailed = (error: PlatformError): CounselError =>
  CounselError.make({ message: error.message, code: ErrorCode.SPAWN_FAILED });

/** SIGTERM, then SIGKILL after the grace period. Forked so callers do not block on it. */
const terminate = (proc: ChildProcessHandle) =>
  proc.kill({ killSignal: "SIGTERM", forceKillAfter: KILL_GRACE_PERIOD_MS }).pipe(Effect.ignore);

const awaitExit = (proc: ChildProcessHandle): Effect.Effect<number, CounselError> =>
  proc.exitCode.pipe(Effect.mapError(spawnFailed));

const waitForExit = Effect.fn("InvocationRunner.waitForExit")(function* (
  proc: ChildProcessHandle,
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
  static layer: Layer.Layer<InvocationRunnerService, never, ChildProcessSpawner | FileSystem> =
    Layer.effect(
      InvocationRunnerService,
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner;
        const fs = yield* FileSystem;

        return {
          execute: (invocation, outputFile, stderrFile, timeoutSeconds = DEFAULT_TIMEOUT_SECONDS) =>
            Effect.gen(function* () {
              const startedAt = yield* Clock.currentTimeMillis;
              const proc = yield* spawner
                .spawn(
                  ChildProcess.make(invocation.cmd, [...invocation.args], {
                    cwd: invocation.cwd,
                    stdin: "ignore",
                    stdout: "pipe",
                    stderr: "pipe",
                  }),
                )
                .pipe(Effect.mapError(spawnFailed));

              // Drain both streams to their log files concurrently with the wait,
              // otherwise the child blocks once the pipe buffers fill.
              yield* Effect.forkScoped(
                Stream.run(proc.stdout, fs.sink(outputFile)).pipe(Effect.ignore),
              );
              yield* Effect.forkScoped(
                Stream.run(proc.stderr, fs.sink(stderrFile)).pipe(Effect.ignore),
              );

              const execution = yield* waitForExit(proc, timeoutSeconds);
              const finishedAt = yield* Clock.currentTimeMillis;
              return {
                exitCode: execution.exitCode,
                durationMs: finishedAt - startedAt,
                timedOut: execution.timedOut,
              };
            }).pipe(Effect.scoped),
        };
      }),
    );

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
