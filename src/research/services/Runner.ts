import { Clock, Effect, Layer, Context, Stream } from "effect";
import type { PlatformError } from "effect/PlatformError";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import { ResearchError, ErrorCode } from "../errors.js";
import { BenchmarkResult } from "../types.js";

const benchmarkFailed = (e: PlatformError) =>
  ResearchError.make({
    message: `Benchmark execution failed: ${e.message}`,
    code: ErrorCode.BENCHMARK_FAILED,
  });

const RESULT_RE = /^RESULT\s+([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)$/;

const parseResult = (stdout: string): { value: number | undefined; count: number } => {
  let value: number | undefined;
  let count = 0;
  for (const line of stdout.split("\n")) {
    const match = RESULT_RE.exec(line.trim());
    if (match !== null) {
      const rawValue = match[1];
      if (rawValue !== undefined) {
        const parsed = Number(rawValue);
        if (!Number.isNaN(parsed)) {
          value = parsed;
          count++;
        }
      }
    }
  }
  return { value, count };
};

export class RunnerService extends Context.Service<
  RunnerService,
  {
    readonly run: (
      cmd: string,
      cwd: string,
      timeoutMs?: number,
    ) => Effect.Effect<BenchmarkResult, ResearchError>;
  }
>()("@cvr/okra/research/services/Runner/RunnerService") {
  static layer: Layer.Layer<RunnerService, never, ChildProcessSpawner> = Layer.effect(
    RunnerService,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner;

      return {
        run: (cmd, cwd, timeoutMs) => {
          const execute = Effect.gen(function* () {
            const start = yield* Clock.currentTimeMillis;
            const handle = yield* spawner.spawn(
              ChildProcess.make("sh", ["-c", cmd], {
                stdout: "pipe",
                stderr: "pipe",
                cwd,
              }),
            );

            const [stdout, stderr, exitCode] = yield* Effect.all(
              [
                Stream.mkString(Stream.decodeText(handle.stdout)),
                Stream.mkString(Stream.decodeText(handle.stderr)),
                handle.exitCode,
              ],
              { concurrency: "unbounded" },
            );

            const end = yield* Clock.currentTimeMillis;
            const durationMs = end - start;
            const parsed = parseResult(stdout);

            return BenchmarkResult.make({
              stdout,
              stderr,
              exitCode,
              durationMs,
              value: parsed.value,
            });
          }).pipe(Effect.scoped, Effect.catchTag("PlatformError", benchmarkFailed));

          if (timeoutMs !== undefined) {
            return execute.pipe(
              Effect.timeout(`${timeoutMs} millis`),
              Effect.catchTag("TimeoutError", () =>
                Effect.fail(
                  ResearchError.make({
                    message: `Benchmark timed out after ${timeoutMs}ms`,
                    code: ErrorCode.BENCHMARK_TIMEOUT,
                  }),
                ),
              ),
            );
          }

          return execute;
        },
      };
    }),
  );
}

export { parseResult };
