import { Effect, Layer, ServiceMap } from "effect";
import { ResearchError, ErrorCode } from "../errors.js";
import { BenchmarkResult } from "../types.js";

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

export class RunnerService extends ServiceMap.Service<
  RunnerService,
  {
    readonly run: (
      cmd: string,
      cwd: string,
      timeoutMs?: number,
    ) => Effect.Effect<BenchmarkResult, ResearchError>;
  }
>()("@cvr/okra/research/services/Runner/RunnerService") {
  static layer: Layer.Layer<RunnerService> = Layer.succeed(RunnerService, {
    run: (cmd, cwd, timeoutMs) => {
      const execute = Effect.tryPromise({
        try: async () => {
          const start = Date.now();
          const proc = Bun.spawn(["sh", "-c", cmd], {
            stdout: "pipe",
            stderr: "pipe",
            cwd,
          });

          const [stdout, stderr, exitCode] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
          ]);

          const durationMs = Date.now() - start;
          const parsed = parseResult(stdout);

          return new BenchmarkResult({
            stdout,
            stderr,
            exitCode,
            durationMs,
            value: parsed.value,
          });
        },
        catch: (e) =>
          new ResearchError({
            message: `Benchmark execution failed: ${e instanceof Error ? e.message : String(e)}`,
            code: ErrorCode.BENCHMARK_FAILED,
          }),
      });

      if (timeoutMs !== undefined) {
        return execute.pipe(
          Effect.timeout(`${timeoutMs} millis`),
          Effect.catchTag("TimeoutError", () =>
            Effect.fail(
              new ResearchError({
                message: `Benchmark timed out after ${timeoutMs}ms`,
                code: ErrorCode.BENCHMARK_TIMEOUT,
              }),
            ),
          ),
        );
      }

      return execute;
    },
  });
}

export { parseResult };
